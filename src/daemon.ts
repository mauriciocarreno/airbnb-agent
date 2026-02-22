import { CalendarAgent } from './calendar';
import { PlannerAgent } from './planner';
import { LiaisonAgent } from './liaison';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const PROCESSED_TASKS_FILE = path.resolve(process.cwd(), 'processed_tasks.json');

function getProcessedTasks(): Set<string> {
    if (fs.existsSync(PROCESSED_TASKS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(PROCESSED_TASKS_FILE, 'utf-8'));
            return new Set(data);
        } catch (e) {
            return new Set();
        }
    }
    return new Set();
}

function saveProcessedTasks(processed: Set<string>) {
    fs.writeFileSync(PROCESSED_TASKS_FILE, JSON.stringify(Array.from(processed), null, 2));
}

async function runIteration() {
    const dummyPath = path.resolve(process.cwd(), 'dummy_calendar.ics');
    const tasksPath = path.resolve(process.cwd(), 'tasks.json');
    const calendarSource = process.env.AIRBNB_CALENDAR_URL || dummyPath;
    const ownerPhone = process.env.OWNER_PHONE;

    if (!ownerPhone) {
        console.error("ERROR: OWNER_PHONE not configured in .env");
        return;
    }

    console.log(`\n[${new Date().toLocaleString()}] Starting synchronization scan...`);

    const calendar = new CalendarAgent(calendarSource);
    const planner = new PlannerAgent(tasksPath);
    const liaison = new LiaisonAgent();
    const processed = getProcessedTasks();

    try {
        const slots = await calendar.findAvailableSlots(30);
        const scheduled = planner.schedule(slots);

        // Filter tasks that haven't been processed yet
        // Task unique key: title + start_time
        const newTasks = scheduled.filter(s => {
            const key = `${s.task.id}-${s.start.getTime()}`;
            return !processed.has(key);
        });

        if (newTasks.length === 0) {
            console.log('No new tasks found.');
            return;
        }

        console.log(`Found ${newTasks.length} new tasks to schedule.`);

        let summaryMessage = `*New Airbnb Tasks Detected*\n\n`;
        const generatedMessages: { providerId: string, message: string, key: string }[] = [];

        for (const s of newTasks) {
            const key = `${s.task.id}-${s.start.getTime()}`;
            console.log(`[DAEMON] Processing: ${s.task.title}`);
            const message = await liaison.generateProviderMessage(s);

            generatedMessages.push({
                providerId: s.task.providerId,
                message: message,
                key: key
            });

            summaryMessage += `🔹 *${s.task.title}* (${s.task.providerId})\n`;
            summaryMessage += `   🕒 ${s.start.toLocaleString()} - ${s.end.toLocaleString()}\n\n`;

            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        summaryMessage += `Reply *Yes* to approve and send all, or *No* to ignore.`;

        // Send summary to owner
        const receiverId = process.env.SUMMARY_RECEIVER_ID || "owner";
        const summarySent = await liaison.sendMessage(receiverId, summaryMessage);

        if (!summarySent) {
            console.error("Failed to send summary to owner.");
            return;
        }

        // Wait for WhatsApp approval (5 min timeout for daemon auto-ignore)
        const isApproved = await liaison.waitForApproval(ownerPhone, 5);

        if (isApproved) {
            console.log("Approved by owner. Dispatching to providers...");
            for (const item of generatedMessages) {
                const success = await liaison.sendMessage(item.providerId, item.message);
                if (success) {
                    processed.add(item.key);
                    console.log(`[SUCCESS] Sent to ${item.providerId}`);
                }
            }
            saveProcessedTasks(processed);
        } else {
            console.log("Not approved or timed out. Skipping this batch.");
        }

    } catch (err) {
        console.error("Error in daemon iteration:", err);
    }
}

async function daemon() {
    console.log("=== Airbnb Agent Daemon Mode Started ===");
    const ownerJid = process.env.OWNER_JID;
    const liaison = new LiaisonAgent();

    if (!ownerJid) {
        console.error("ERROR: OWNER_JID not configured in .env");
        process.exit(1);
    }

    // Loop 1: Periodic Polling (Every 60 minutes)
    const pollingLoop = async () => {
        while (true) {
            await runIteration();
            console.log(`\n[Polling] Sleeping for 60 minutes...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * 60 * 60));
        }
    };

    // Loop 2: Command Listener (Real-time)
    const commandLoop = async () => {
        while (true) {
            console.log(`[Listener] Ready for WhatsApp commands ("scan" or "tasks")...`);
            try {
                const triggered = await liaison.listenForCommand(ownerJid, "scan");
                if (triggered) {
                    console.log(`[Trigger] Manual scan requested via WhatsApp.`);
                    await runIteration();
                }
            } catch (e) {
                console.error("[Listener] Error in command listener:", e);
            }
            // Small pause before restarting listener
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    };

    // Run both in parallel
    console.log("Starting parallel loops: [Polling] and [Command Listener]");
    Promise.all([pollingLoop(), commandLoop()]).catch(console.error);
}

daemon().catch(console.error);
