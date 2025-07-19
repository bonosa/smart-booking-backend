// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection (Railway PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Anthropic AI client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Email transporter (using Gmail as example)
const emailTransporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD // Gmail App Password
  }
});

// Initialize database tables
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        message TEXT,
        ai_analysis JSONB,
        email_content TEXT,
        status VARCHAR(50) DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        subscription_tier VARCHAR(50) DEFAULT 'free',
        api_calls_used INTEGER DEFAULT 0,
        api_calls_limit INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  }
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Analyze message with Claude AI
app.post('/api/analyze-message', async (req, res) => {
  try {
    const { message, userEmail } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check API usage limits (optional)
    if (userEmail) {
      const userResult = await pool.query(
        'SELECT api_calls_used, api_calls_limit FROM users WHERE email = $1',
        [userEmail]
      );
      
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        if (user.api_calls_used >= user.api_calls_limit) {
          return res.status(429).json({ error: 'API limit exceeded' });
        }
      }
    }

    // Call Claude AI
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Analyze this appointment booking message and respond with ONLY a JSON object:

"${message}"

Return exactly this structure:
{
  "sentiment": "positive" or "neutral" or "urgent",
  "suggestedDuration": 15 or 30 or 45 or 60 or 90,
  "topics": ["Business consultation"] or ["Technical support"] or ["Medical consultation"] or ["General consultation"],
  "priority": "high" or "medium" or "low", 
  "suggestions": ["Helpful suggestion 1", "Helpful suggestion 2", "Helpful suggestion 3"]
}

Consider:
- Urgent words: urgent, asap, emergency, critical, immediately
- Business words: meeting, consultation, strategy, interview
- Technical words: support, technical, issue, problem, bug
- Medical words: medical, health, doctor, appointment
- Long/complex messages suggest longer duration
- Urgent tone = high priority`
      }]
    });

    let aiResponse = response.content[0].text;
    
    // Clean up response to extract JSON
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      aiResponse = jsonMatch[0];
    }
    
    const analysisResult = JSON.parse(aiResponse);

    // Update API usage count
    if (userEmail) {
      await pool.query(
        'UPDATE users SET api_calls_used = api_calls_used + 1 WHERE email = $1',
        [userEmail]
      );
    }

    res.json(analysisResult);

  } catch (error) {
    console.error('AI analysis failed:', error);
    res.status(500).json({ 
      error: 'Analysis failed',
      fallback: {
        sentiment: 'neutral',
        suggestedDuration: 30,
        topics: ['General consultation'],
        priority: 'medium',
        suggestions: ['Standard booking recommended', 'Consider morning slots', 'Prepare questions in advance']
      }
    });
  }
});

// Generate email content with Claude AI
app.post('/api/generate-email', async (req, res) => {
  try {
    const { name, date, time, message, analysis } = req.body;

    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Write a professional appointment confirmation email for:

Name: ${name}
Date: ${date}
Time: ${time}
Duration: ${analysis?.suggestedDuration || 30} minutes
Priority: ${analysis?.priority || 'medium'}
Topics: ${analysis?.topics?.join(', ') || 'General consultation'}
User Message: "${message}"

Make it warm, professional, and include:
1. Confirmation of details
2. Preparation suggestions based on the topics
3. Contact info for changes
4. Professional closing

Use emojis sparingly and keep it concise but personalized.`
      }]
    });

    res.json({ emailContent: response.content[0].text });

  } catch (error) {
    console.error('Email generation failed:', error);
    res.status(500).json({ 
      error: 'Email generation failed',
      emailContent: `Dear ${req.body.name},\n\nYour appointment has been confirmed for ${req.body.date} at ${req.body.time}.\n\nThank you for booking with Smart Booking Pro!\n\nBest regards,\nThe Team`
    });
  }
});

// Create booking and send email
app.post('/api/create-booking', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      appointmentDate, 
      appointmentTime, 
      message, 
      aiAnalysis, 
      emailContent 
    } = req.body;

    // Insert booking into database
    const result = await pool.query(
      `INSERT INTO bookings (name, email, appointment_date, appointment_time, message, ai_analysis, email_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, email, appointmentDate, appointmentTime, message, JSON.stringify(aiAnalysis), emailContent]
    );

    const bookingId = result.rows[0].id;

    // Send confirmation email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Appointment Confirmation - ${appointmentDate} at ${appointmentTime}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">🚀 Smart Booking Pro - Appointment Confirmed!</h2>
          <div style="background: #f8fafc; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3>Booking ID: #${bookingId}</h3>
            <pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${emailContent}</pre>
          </div>
          <p style="color: #64748b; font-size: 14px;">
            This email was generated using AI and sent automatically by Smart Booking Pro.
          </p>
        </div>
      `
    };

    await emailTransporter.sendMail(mailOptions);

    // Create or update user record
    await pool.query(
      `INSERT INTO users (email, name, api_calls_used) 
       VALUES ($1, $2, 1) 
       ON CONFLICT (email) 
       DO UPDATE SET api_calls_used = users.api_calls_used + 1`,
      [email, name]
    );

    res.json({ 
      success: true, 
      bookingId,
      message: 'Booking created and email sent successfully'
    });

  } catch (error) {
    console.error('Booking creation failed:', error);
    res.status(500).json({ 
      error: 'Booking failed',
      details: error.message
    });
  }
});

// Get all bookings (admin endpoint)
app.get('/api/bookings', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bookings ORDER BY created_at DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get user stats
app.get('/api/user-stats/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.json({ 
        email,
        apiCallsUsed: 0,
        apiCallsLimit: 100,
        subscriptionTier: 'free'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to fetch user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

// Start server
async function startServer() {
  await initDB();
  
  app.listen(port, () => {
    console.log(`🚀 Smart Booking Pro Backend running on port ${port}`);
    console.log(`📧 Email service: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
    console.log(`🤖 Claude AI: ${process.env.ANTHROPIC_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`🗄️  Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not connected'}`);
  });
}

startServer().catch(console.error);