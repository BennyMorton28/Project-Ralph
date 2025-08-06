// Configuration file for database and API settings
// Use environment variables for sensitive data

module.exports = {
    // Database configuration
    database: {
        connectionString: process.env.DATABASE_URL || 'postgres://reports:jgMCen4W_YscgzpqCvE8@negotiation-service-ralph-prod-1-deals-db-1.c7rubifcaefj.us-west-2.rds.amazonaws.com:5432/deals',
        // Alternative: individual components
        host: process.env.DB_HOST || 'negotiation-service-ralph-prod-1-deals-db-1.c7rubifcaefj.us-west-2.rds.amazonaws.com',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'deals',
        user: process.env.DB_USER || 'reports',
        password: process.env.DB_PASSWORD || 'jgMCen4W_YscgzpqCvE8'
    },
    
    // JSONBin API configuration
    jsonbin: {
        apiKey: process.env.JSONBIN_API_KEY || '$2a$10$SEnNfh62rZ5cbmvsRc5iGu5FElaadU.JCpjWywSTIWkdZWEWvt3.i',
        binId: process.env.JSONBIN_BIN_ID || '689168af7b4b8670d8ad55e0',
        url: 'https://api.jsonbin.io/v3/b'
    },
    
    // Server configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || 'localhost'
    }
}; 