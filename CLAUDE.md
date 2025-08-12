# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Ralph is a comprehensive car buying assistant project with metrics dashboard and PostgreSQL database integration. The project consists of:

1. **Frontend Dashboard** - HTML-based visual project tracker with metrics and progress monitoring
2. **Backend API Server** - Express.js server providing REST API endpoints for deal data and analysis
3. **Database Integration** - PostgreSQL connection for dealership and deal data analysis
4. **Grading System** - Comprehensive dealer grading based on fee analysis

## Development Commands

### Start the application
```bash
npm start          # Production server
npm run dev        # Development server with nodemon
```

### Database connection
The application connects to PostgreSQL using configuration from `config.js`. Ensure VPN connection is active for database access.

## Architecture

### Backend Structure (`server.js`)
- **Express.js API server** with CORS enabled for frontend integration
- **PostgreSQL integration** using `pg` library with connection pooling
- **API endpoints** for deal summary, recent activity, driver metrics, and dealership analysis
- **Error handling** with database connection testing and fallback responses

### Key API Endpoints
- `/api/deal-summary` - Overall deal statistics and state distribution
- `/api/recent-activity` - Recent deal updates and dealer information  
- `/api/driver-metrics` - Dealership analysis progress toward 10 deals per dealer goal
- `/api/dealership-analysis` - Dealer performance and deal counts
- `/api/deal-details/:dealId` - Comprehensive deal information including conversation data
- `/api/dealership-rankings` - Dealer rankings based on grading system
- `/api/deal-grading/:dealId` - Individual deal grading based on fee analysis

### Grading System (`grading-system.js`)
- **Fee-based grading** using excessive and illegitimate fee thresholds
- **Deal scoring** with weighted average (40% excessive fees, 60% illegitimate fees)
- **Dealer rankings** based on average scores across multiple analysis-stage deals
- **Grade distribution** tracking (A/B/C/D/F) with explanations

### Configuration (`config.js`)
- **Database connection** via environment variables or hardcoded fallbacks
- **JSONBin API** configuration for cloud data persistence
- **Server settings** with port and host configuration

## Database Schema Understanding

The application works with several key PostgreSQL tables:
- `deals` - Main deal records with state tracking (`analysis`, `vin_sold`, etc.)
- `listings` - Deal-to-dealer relationship mapping
- `dealers` - Dealership information (name, city, state)
- `deal_tasks` - Task execution records with JSON payloads containing conversation data
- `events` - Email and communication event tracking
- `conversations` & `messages` - Conversation data storage

## Frontend Structure

### Main Dashboard (`index.html`)
- **Real-time progress tracking** with animated progress bars
- **Interactive todo list** with browser storage persistence
- **Dealer tier system** (Order of the Coif, Dean's List, Honor Roll, Detention)
- **Timeline visualization** for 4-week project phases

### Metrics Dashboard (`metrics.html`)
- **Deal summary statistics** via API integration
- **Dealership analysis** with progress toward goals
- **Recent activity tracking** with dealer information
- **Driver metrics** for deadline management

### Deal Details (`deal-details.html`)
- **Comprehensive deal view** with conversation history
- **Risk analysis** and pricing information
- **Task execution** history and status

## Development Workflow

### Database Operations
- All database queries include connection testing with `SELECT 1`
- Error responses include VPN connection reminders
- Connection pooling is used for performance

### Data Processing
- Deal grading only processes deals in `analysis` state
- Conversation data is extracted from multiple sources (tasks, events, messages)
- Fee analysis uses weighted scoring for dealer rankings

### Frontend-Backend Integration
- CORS enabled for cross-origin requests
- Static file serving for HTML/CSS/JS assets
- RESTful API design with JSON responses

## Security Considerations

- Database credentials should be moved to environment variables
- `.env` files are properly gitignored
- API keys for JSONBin should use environment variables in production
- VPN requirement for database access provides additional security layer

## Deployment

### Local Development
1. Install dependencies: `npm install`
2. Configure environment variables or update `config.js`
3. Ensure VPN connection for database access
4. Start development server: `npm run dev`

### Production Deployment
- Frontend can be deployed to GitHub Pages
- Backend requires Node.js hosting with PostgreSQL access
- Environment variables must be configured for production database and API keys

## Key Data Flows

1. **Deal Analysis Pipeline**: Deals → Risk Assessment → Fee Analysis → Grading → Rankings
2. **Metrics Dashboard**: Database Queries → API Responses → Frontend Visualization
3. **Conversation Tracking**: Multiple Data Sources → Unified Conversation View → Frontend Display

## Critical Database Tables

**Core Tables:**
- `deals` - Main deal records with state tracking (`analysis`, `vin_sold`, etc.)
- `deal_risk_analysis` - Contains pricing calculations including `offer_price`, `internet_price`, `current_bottom_line_price`
- `deal_tasks` - Task execution records with JSON payloads containing conversation data
- `ad_info` - Advertisement information linked via `listings` table for Internet Price
- `listings` - Maps deals to dealers and ad_info (deal_id, dealer_id, ad_info_id)
- `dealers` - Dealership information (name, city, state)

**Supporting Tables:**
- `events` - Email and communication event tracking
- `conversations` & `messages` - Conversation data storage

## Risk Analysis Calculation Logic

**Current Bottom Line Price Formula:**
- When `offer_price > 0`: Use offer_price from `deal_risk_analysis` table
- When `offer_price = 0`: Extract from conversation data or fall back to internet_price
- **Universal Formula**: `base_price + quoted_tax + normal_fees + excessive_fees + illegitimate_fees`

**Fair Bottom Line Price:**
- `current_bottom_line_price - illegitimate_fees`
- Add $100 adjustment for deals under $50,000

**Data Source Priority:**
1. `deal_risk_analysis.offer_price` (database)
2. Conversation parsing from `deal_tasks` (INVOKE_DEAL_ACTION tasks)
3. `ad_info.price` as internet_price fallback

## Environment Dependencies

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `ANTHROPIC_API_KEY` - For AI conversation processing
- `JSONBIN_API_KEY` - Cloud data persistence
- `JSONBIN_BIN_ID` - Specific bin identifier

**VPN Requirement:**
Database access requires active VPN connection to AWS RDS instance in us-west-2.

## Testing and Debugging

The application includes several debug endpoints:
- `/api/task-types` - Lists all task types in the database
- `/api/database-tables` - Shows all available database tables
- `/api/debug-messages/:dealId` - Debug message table contents
- `/api/email-search/:dealId` - Search for email data across tables