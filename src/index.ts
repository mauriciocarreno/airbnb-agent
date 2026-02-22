import { CalendarAgent } from './calendar';
import { PlannerAgent } from './planner';
import { LiaisonAgent } from './liaison';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function main() {
  const dummyPath = path.resolve(process.cwd(), 'dummy_calendar.ics');
  const tasksPath = path.resolve(process.cwd(), 'tasks.json');

  const calendarSource = process.env.AIRBNB_CALENDAR_URL;
  if (!calendarSource) {
    throw new Error("AIRBNB_CALENDAR_URL no está configurado en el archivo .env");
  }

  console.log(`[Calendar] Reading from: ${calendarSource.startsWith('http') ? 'Airbnb URL' : calendarSource}`);
  const calendar = new CalendarAgent(calendarSource);
  const planner = new PlannerAgent(tasksPath);
  const liaison = new LiaisonAgent();

  try {
    const slots = await calendar.findAvailableSlots(30);
    console.log(`[Calendar] Found ${slots.length} available slots.`);

    console.log('\n--- Scheduling Tasks ---');
    const scheduled = planner.schedule(slots);

    if (scheduled.length === 0) {
      console.log('No tasks scheduled.');
      return;
    }

    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) {
      throw new Error("OWNER_PHONE no está configurado en el archivo .env");
    }
    let summaryMessage = `*Resumen de Tareas Programadas para Airbnb*\n\n`;
    const generatedMessages: { providerId: string, message: string }[] = [];

    // Generar los mensajes y armar el resumen
    for (const s of scheduled) {
      console.log(`\n[SCHEDULED] ${s.task.title} (${s.task.providerId})`);
      console.log(`            Time: ${s.start.toLocaleString()} - ${s.end.toLocaleString()}`);

      process.stdout.write("  > Generando propuesta de mensaje con Nanobot... ");
      const message = await liaison.generateProviderMessage(s);

      generatedMessages.push({
        providerId: s.task.providerId,
        message: message
      });

      console.log("¡Listo!");

      summaryMessage += `🔹 *${s.task.title}* (${s.task.providerId})\n`;
      summaryMessage += `   🕒 ${s.start.toLocaleString()} - ${s.end.toLocaleString()}\n\n`;

      // Esperar 10 segundos para no saturar el TPM de Groq (6000 limit)
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    summaryMessage += `¿Deseas enviar estos mensajes a los proveedores? (Responde *Si* para aprobar o *No* para cancelar)`;

    // Enviar el resumen al Owner
    const receiverId = process.env.SUMMARY_RECEIVER_ID || "owner";
    console.log(`\n====================================`);
    console.log(`Enviando resumen de validación al owner (${ownerPhone})...`);

    const summarySent = await liaison.sendMessage(receiverId, summaryMessage);

    if (!summarySent) {
      console.log("❌ Error enviando mensaje de resumen al owner.");
      return;
    }

    console.log("✅ Resumen enviado. Esperando respuesta por WhatsApp (máximo 10 min)...");

    const isApproved = await liaison.waitForApproval(ownerPhone, 10);

    if (isApproved) {
      console.log("\n====================================");
      console.log("✅ ¡Aprobado por el Owner! Enviando mensajes a proveedores...");

      for (const item of generatedMessages) {
        const success = await liaison.sendMessage(item.providerId, item.message);
        if (success) {
          console.log(`[EXITO] Mensaje enviado a ${item.providerId}.`);
        } else {
          console.log(`[ERROR] No se pudo enviar el mensaje a ${item.providerId}.`);
        }
      }
    } else {
      console.log("\n====================================");
      console.log("❌ El envío fue cancelado o se agostó el tiempo de espera.");
    }

  } catch (err) {
    console.error("An error occurred:", err);
  } finally {
    process.exit(0);
  }
}

main().catch(console.error);
