# Airbnb Management Agent

Automated task scheduling and communication system for Airbnb properties. This agent reads your Airbnb iCal calendar, identifies availability windows, schedules maintenance tasks, and coordinates with providers via WhatsApp using Nanobot.

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: Installed on your system.
- **Docker**: Used to run Nanobot (the AI core and WhatsApp bridge).
- **Nanobot**: Must be running as a container named `nanobot`.

### 2. Environment Configuration
Create a `.env` file in the root directory and configure the following variables:

```env
# URL of your Airbnb iCal calendar
AIRBNB_CALENDAR_URL="your_ical_url_here"

# Your phone number (used for logs and validation reports)
OWNER_PHONE="56XXXXXXXXX"

# Your WhatsApp JID (used to approve task scheduling via WhatsApp)
OWNER_JID="56XXXXXXXXX@s.whatsapp.net"

# The provider ID from providers.json that will receive the summary message
SUMMARY_RECEIVER_ID="tester"
```

### 3. Installation
```bash
npm install
```

### 4. Running the Agent
```bash
npm run start
```

## 🛠 Project Structure

- `src/index.ts`: Main entry point and orchestration loop.
- `src/calendar.ts`: Fetches and parses Airbnb iCal events to find gaps.
- `src/planner.ts`: Schedules tasks from `tasks.json` into available slots.
- `src/liaison.ts`: Handles AI message generation and WhatsApp communication.
- `tasks.json`: List of pending tasks to be scheduled.
- `providers.json`: Registry of service providers and their contact info.

## 🤖 AI Core (Nanobot)
The system uses **Nanobot** running in a Docker container to:
1. Generate professional messages using Groq/OpenRouter.
2. Bridge communication with WhatsApp.

Ensure Nanobot is configured with your API keys in `/root/.nanobot/config.json` inside the container.
