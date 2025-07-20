require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.vercel.app', 'https://your-frontend-domain.netlify.app'] 
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection (Railway PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Anthropic AI client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Email transporter (Gmail)
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

// Initialize database tables
async function initDB() {
  try {
    // Bookings table
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        subscription_tier VARCHAR(50) DEFAULT 'free',
        api_calls_used INTEGER DEFAULT 0,
        api_calls_limit INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Chat interactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_interactions (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255),
        message TEXT NOT NULL,
        response JSONB,
        context JSONB,
        response_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Social media cache table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_media_cache (
        id SERIAL PRIMARY KEY,
        platform VARCHAR(50) NOT NULL,
        post_data JSONB NOT NULL,
        engagement_data JSONB,
        fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  }
}

// Test database connection
async function testDB() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0].now);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

// Test email configuration
async function testEmail() {
  try {
    await emailTransporter.verify();
    console.log('✅ Email service configured successfully');
  } catch (error) {
    console.error('❌ Email service configuration failed:', error);
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.2.0',
    services: {
      database: 'unknown',
      email: 'unknown',
      ai: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured'
    }
  };

  // Test database
  try {
    await pool.query('SELECT 1');
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'error';
  }

  // Test email
  try {
    await emailTransporter.verify();
    health.services.email = 'configured';
  } catch (error) {
    health.services.email = 'error';
  }

  res.json(health);
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Smart Booking Pro Backend is running!',
    version: '1.2.0',
    features: [
      'AI Chatbot with Social Media Awareness',
      'Smart Appointment Booking', 
      'AI-Generated Email Automation',
      'Real-time Analytics',
      'Multi-Interface Support'
    ],
    endpoints: {
      health: '/health',
      chatbot: '/api/chatbot',
      analyze: '/api/analyze-message',
      email: '/api/generate-email',
      booking: '/api/create-booking',
      bookings: '/api/bookings',
      stats: '/api/stats'
    }
  });
});

// AI Chatbot endpoint with social media awareness
app.post('/api/chatbot', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { message, context, userEmail } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Rate limiting check
    if (userEmail) {
      const user = await pool.query(
        'SELECT api_calls_used, api_calls_limit FROM users WHERE email = $1',
        [userEmail]
      );
      
      if (user.rows.length > 0) {
        const { api_calls_used, api_calls_limit } = user.rows[0];
        if (api_calls_used >= api_calls_limit) {
          return res.status(429).json({ 
            error: 'Daily API limit exceeded. Please upgrade your plan.' 
          });
        }
      }
    }

    // Enhanced chatbot prompt with social media context
    const chatbotPrompt = `You are a smart, engaging booking assistant for Smart Booking Pro - an AI-powered appointment booking system.

Current Context:
- User message: "${message}"
- Chat history: ${JSON.stringify(context?.userHistory?.slice(-3) || [])}
- Social media trends: #SmartBooking #AIAppointments #AutomatedScheduling

Social Media Context:
- Twitter: "Just launched our AI booking system! 🚀 Reduced booking time by 80% #SmartBooking"
- LinkedIn: "Case study: How AI transformed appointment scheduling for 500+ businesses"
- Instagram: "Behind the scenes: Our Claude AI integration process ✨"

Your capabilities:
- Book appointments through natural conversation
- Analyze user needs with AI
- Generate personalized emails
- Provide smart scheduling recommendations
- Answer questions about services (Business, Technical, Medical consultations)
- Reference social media when relevant

Personality: Friendly, helpful, professional, use emojis sparingly, be conversational.

Respond with ONLY a JSON object:
{
  "content": "Your engaging, helpful response (mention social media context when relevant)",
  "suggestions": ["Quick reply 1", "Quick reply 2", "Quick reply 3"],
  "action": "book_appointment" or "show_social" or "explain_features" or null,
  "mood": "helpful" or "excited" or "professional"
}

Guidelines:
- If users want to book, guide them enthusiastically
- If they ask about features, mention our 80% time reduction
- If they mention social media, reference our actual posts
- Be helpful and engaging, not robotic
- Keep responses conversational and natural`;

    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: chatbotPrompt
      }]
    });

    let aiResponse = response.content[0].text;
    
    // Clean up response to extract JSON
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      aiResponse = jsonMatch[0];
    }
    
    const chatbotResponse = JSON.parse(aiResponse);
    const responseTime = Date.now() - startTime;

    // Log interaction for analytics
    try {
      await pool.query(
        'INSERT INTO chat_interactions (user_email, message, response, context, response_time_ms) VALUES ($1, $2, $3, $4, $5)',
        [userEmail || null, message, JSON.stringify(chatbotResponse), JSON.stringify(context || {}), responseTime]
      );

      // Update user API usage
      if (userEmail) {
        await pool.query(
          `INSERT INTO users (email, api_calls_used, last_active) 
           VALUES ($1, 1, NOW()) 
           ON CONFLICT (email) 
           DO UPDATE SET api_calls_used = users.api_calls_used + 1, last_active = NOW()`,
          [userEmail]
        );
      }
    } catch (logError) {
      console.error('Failed to log chat interaction:', logError);
    }

    res.json({
      response: chatbotResponse,
      responseTime: responseTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chatbot error:', error);
    
    // Intelligent fallback response
    const fallbackResponse = generateFallbackResponse(req.body.message || '');
    
    res.json({
      response: fallbackResponse,
      fallback: true,
      error: 'AI temporarily unavailable'
    });
  }
});

// Analyze message with Claude AI
app.post('/api/analyze-message', async (req, res) => {
  try {
    const { message, userEmail } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Analyze this appointment booking message and respond with ONLY a JSON object:

Message: "${message}"

Return exactly this structure:
{
  "sentiment": "positive" or "neutral" or "urgent",
  "suggestedDuration": 15 or 30 or 45 or 60 or 90,
  "topics": ["Business consultation"] or ["Technical support"] or ["Medical consultation"] or ["General consultation"],
  "priority": "high" or "medium" or "low", 
  "suggestions": ["Helpful suggestion 1", "Helpful suggestion 2", "Helpful suggestion 3"],
  "confidence": 0.85
}

Analysis guidelines:
- Urgent words: urgent, asap, emergency, critical, immediately = urgent sentiment, high priority
- Business words: meeting, consultation, strategy, interview = Business consultation
- Technical words: support, technical, issue, problem, bug = Technical support  
- Medical words: medical, health, doctor, appointment = Medical consultation
- Message length > 200 chars = longer duration (60-90 min)
- Message length < 50 chars = shorter duration (15-30 min)`
      }]
    });

    let aiResponse = response.content[0].text;
    
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      aiResponse = jsonMatch[0];
    }
    
    const analysisResult = JSON.parse(aiResponse);

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
        suggestions: ['Standard booking recommended', 'Consider morning slots', 'Prepare questions in advance'],
        confidence: 0.5
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
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Write a professional, warm appointment confirmation email:

Details:
- Name: ${name}
- Date: ${date} 
- Time: ${time}
- Duration: ${analysis?.suggestedDuration || 30} minutes
- Priority: ${analysis?.priority || 'medium'}
- Topics: ${analysis?.topics?.join(', ') || 'General consultation'}
- User message: "${message}"

Include:
1. Warm greeting and confirmation
2. All appointment details clearly
3. Preparation suggestions based on topics
4. Contact info for changes/questions
5. Professional but friendly closing

Style: Professional, warm, concise, use emojis sparingly.
Format: Plain text with line breaks for readability.`
      }]
    });

    res.json({ 
      emailContent: response.content[0].text,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Email generation failed:', error);
    
    // Fallback email template
    const fallbackEmail = `Dear ${req.body.name},

Thank you for booking your appointment with Smart Booking Pro!

📅 Appointment Details:
• Date: ${req.body.date}
• Time: ${req.body.time}
• Duration: ${req.body.analysis?.suggestedDuration || 30} minutes
• Type: ${req.body.analysis?.topics?.join(', ') || 'General consultation'}

${req.body.message ? `Your message: "${req.body.message}"` : ''}

${req.body.analysis?.priority === 'high' ? '⚡ High Priority: We have noted the urgency of your request.' : ''}

We look forward to meeting with you! If you need to reschedule or have questions, please contact us at least 24 hours in advance.

Best regards,
The Smart Booking Pro Team
📧 ${process.env.EMAIL_USER || 'support@smartbookingpro.com'}`;

    res.json({ 
      emailContent: fallbackEmail,
      fallback: true,
      error: 'AI email generation failed, using template'
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

    // Validate required fields
    if (!name || !email || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, email, appointmentDate, appointmentTime' 
      });
    }

    // Insert booking into database
    const result = await pool.query(
      `INSERT INTO bookings (name, email, appointment_date, appointment_time, message, ai_analysis, email_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [name, email, appointmentDate, appointmentTime, message || '', JSON.stringify(aiAnalysis), emailContent]
    );

    const booking = result.rows[0];
    const bookingId = booking.id;

    // Send confirmation email
    const mailOptions = {
      from: `Smart Booking Pro <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `🚀 Appointment Confirmed - Smart Booking Pro #${bookingId}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 15px;">
          <div style="background: white; padding: 40px; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #667eea; margin: 0; font-size: 28px; font-weight: bold;">🚀 Smart Booking Pro</h1>
              <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">AI-Powered Appointment System</p>
            </div>

            <!-- Booking Confirmation -->
            <div style="background: linear-gradient(135deg, #f8f9ff 0%, #e3f2fd 100%); padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 5px solid #667eea;">
              <h2 style="color: #333; margin: 0 0 20px 0; font-size: 22px;">✅ Booking Confirmed #${bookingId}</h2>
              
              <!-- Email Content -->
              <div style="white-space: pre-wrap; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.8; color: #444; font-size: 15px;">
${emailContent}
              </div>
            </div>

            <!-- AI Analysis -->
            ${aiAnalysis ? `
            <div style="background: #f0f4ff; padding: 20px; border-radius: 10px; margin: 20px 0;">
              <h3 style="color: #667eea; margin: 0 0 15px 0; font-size: 18px;">🤖 AI Analysis Summary</h3>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                <div style="text-align: center;">
                  <div style="background: ${aiAnalysis.priority === 'high' ? '#ff6b6b' : aiAnalysis.priority === 'medium' ? '#4ecdc4' : '#95a5a6'}; color: white; padding: 8px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase;">
                    ${aiAnalysis.priority} Priority
                  </div>
                </div>
                <div style="text-align: center;">
                  <div style="background: #667eea; color: white; padding: 8px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">
                    ${aiAnalysis.suggestedDuration} Minutes
                  </div>
                </div>
                <div style="text-align: center;">
                  <div style="background: #51cf66; color: white; padding: 8px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">
                    ${aiAnalysis.sentiment}
                  </div>
                </div>
              </div>
            </div>
            ` : ''}

            <!-- Footer -->
            <div style="text-align: center; margin-top: 40px; padding-top: 25px; border-top: 2px solid #f0f0f0;">
              <p style="color: #666; font-size: 14px; margin: 0 0 10px 0;">
                📧 Need to reschedule? Simply reply to this email<br>
                🤖 This email was intelligently generated using Claude AI<br>
                📱 Smart Booking Pro - Making scheduling effortless
              </p>
              <div style="margin-top: 20px;">
                <span style="background: #667eea; color: white; padding: 6px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                  Booking ID: #${bookingId}
                </span>
              </div>
            </div>
          </div>
        </div>
      `
    };

    await emailTransporter.sendMail(mailOptions);

    // Create or update user record
    await pool.query(
      `INSERT INTO users (email, name, api_calls_used, last_active) 
       VALUES ($1, $2, 2, NOW()) 
       ON CONFLICT (email) 
       DO UPDATE SET 
         name = COALESCE(EXCLUDED.name, users.name),
         api_calls_used = users.api_calls_used + 2, 
         last_active = NOW()`,
      [email, name]
    );

    res.json({ 
      success: true, 
      bookingId: bookingId,
      message: 'Booking created and confirmation email sent successfully!',
      booking: {
        id: bookingId,
        name: name,
        email: email,
        date: appointmentDate,
        time: appointmentTime,
        createdAt: booking.created_at
      }
    });

  } catch (error) {
    console.error('Booking creation failed:', error);
    res.status(500).json({ 
      error: 'Booking creation failed',
      details: error.message,
      code: error.code
    });
  }
});

// Get all bookings (admin endpoint)
app.get('/api/bookings', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status = 'all' } = req.query;
    
    let query = 'SELECT * FROM bookings';
    let params = [];
    
    if (status !== 'all') {
      query += ' WHERE status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Get total count
    const countQuery = status !== 'all' 
      ? 'SELECT COUNT(*) FROM bookings WHERE status = $1'
      : 'SELECT COUNT(*) FROM bookings';
    const countParams = status !== 'all' ? [status] : [];
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      bookings: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: Math.floor(offset / limit) + 1,
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Failed to fetch bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get analytics and stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) as total_bookings FROM bookings'),
      pool.query('SELECT COUNT(*) as total_users FROM users'),
      pool.query('SELECT COUNT(*) as total_chats FROM chat_interactions'),
      pool.query('SELECT COUNT(*) as today_bookings FROM bookings WHERE DATE(created_at) = CURRENT_DATE'),
      pool.query('SELECT AVG(response_time_ms) as avg_response_time FROM chat_interactions WHERE response_time_ms IS NOT NULL'),
      pool.query(`
        SELECT 
          DATE(created_at) as date, 
          COUNT(*) as bookings 
        FROM bookings 
        WHERE created_at >= NOW() - INTERVAL '7 days' 
        GROUP BY DATE(created_at) 
        ORDER BY date DESC
      `)
    ]);

    res.json({
      totalBookings: parseInt(stats[0].rows[0].total_bookings),
      totalUsers: parseInt(stats[1].rows[0].total_users),
      totalChats: parseInt(stats[2].rows[0].total_chats),
      todayBookings: parseInt(stats[3].rows[0].today_bookings),
      avgResponseTime: Math.round(parseFloat(stats[4].rows[0].avg_response_time || 0)),
      weeklyBookings: stats[5].rows,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Fallback response generator for when AI fails
function generateFallbackResponse(message) {
  const lowerMessage = (message || '').toLowerCase();
  
  if (lowerMessage.includes('book') || lowerMessage.includes('appointment') || lowerMessage.includes('schedule')) {
    return {
      content: "I'd be happy to help you book an appointment! 📅 Our AI-powered system makes scheduling super fast and easy. According to our recent social media posts, we've reduced booking time by 80%! Ready to experience it yourself?",
      suggestions: ["Yes, let's book!", "Tell me more about AI booking", "What services do you offer?"],
      action: "book_appointment",
      mood: "excited"
    };
  }

  if (lowerMessage.includes('social') || lowerMessage.includes('twitter') || lowerMessage.includes('instagram') || lowerMessage.includes('linkedin')) {
    return {
      content: "Great question about our social media! 📱 We're active across platforms sharing our AI booking innovations:\n\n🐦 Twitter: Latest features and quick tips about smart scheduling\n💼 LinkedIn: Case studies showing 80% time reduction for clients\n📸 Instagram: Behind-the-scenes of our Claude AI development\n\nOur community loves how we've revolutionized appointment booking! What caught your attention?",
      suggestions: ["Book an appointment", "Learn about AI features", "Tell me about the 80% improvement"],
      action: "show_social",
      mood: "helpful"
    };
  }

  if (lowerMessage.includes('ai') || lowerMessage.includes('claude') || lowerMessage.includes('how') || lowerMessage.includes('features')) {
    return {
      content: "Our system uses cutting-edge Claude AI technology! 🤖 Here's what makes Smart Booking Pro special:\n\n✨ Intelligent message analysis\n⏱️ Smart duration suggestions based on content\n📧 Personalized email generation\n🎯 Optimal time slot recommendations\n📊 Real-time analytics and insights\n\nAs featured across our social media, this AI integration has reduced booking time by 80% for our users! Want to experience the magic yourself?",
      suggestions: ["Book an appointment", "See it in action", "What services do you offer?"],
      action: "explain_features",
      mood: "professional"
    };
  }

  if (lowerMessage.includes('help') || lowerMessage.includes('support') || lowerMessage.includes('question')) {
    return {
      content: "I'm here to help! 🤗 As your Smart Booking AI assistant, I can:\n\n📅 Book appointments through natural conversation\n💬 Answer questions about our services\n🔧 Explain our AI features and capabilities\n📊 Share insights from our social media\n📧 Handle all your scheduling needs\n\nOur system is designed to make booking as easy as having a conversation. What would you like to know?",
      suggestions: ["Book an appointment", "Learn about services", "How does AI booking work?"],
      action: null,
      mood: "helpful"
    };
  }

  // Default response
  return {
    content: "Hello! 👋 I'm your Smart Booking AI assistant, powered by Claude AI. I make appointment scheduling incredibly easy and fast!\n\n🚀 According to our social media, we've helped users reduce booking time by 80%\n💬 I can chat naturally to understand your needs\n📅 I'll find the perfect appointment slot for you\n📧 I'll send beautiful confirmation emails\n\nWhat can I help you with today?",
    suggestions: ["Book an appointment", "Learn about AI features", "View our services", "Tell me more"],
    action: null,
    mood: "friendly"
  };
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: ['/health', '/api/chatbot', '/api/analyze-message', '/api/generate-email', '/api/create-booking']
  });
});

// Start server
async function startServer() {
  try {
    // Initialize database
    await initDB();
    
    // Test connections
    await testDB();
    await testEmail();
    
    app.listen(port, () => {
      console.log('\n🚀 Smart Booking Pro Backend v1.2.0');
      console.log(`📡 Server running on port ${port}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📧 Email service: ${process.env.EMAIL_USER ? '✅ Configured (' + process.env.EMAIL_USER + ')' : '❌ Not configured'}`);
      console.log(`🤖 Claude AI: ${process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
      console.log(`🗄️  Database: ${process.env.DATABASE_URL ? '✅ Connected' : '❌ Not connected'}`);
      console.log(`\n📱 Test endpoints:`);
      console.log(`   Health: http://localhost:${port}/health`);
      console.log(`   Root: http://localhost:${port}/`);
      console.log('\n🎉 Ready to accept requests!\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

startServer().catch(console.error);