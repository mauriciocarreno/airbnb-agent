import { CalendarAgent } from './calendar';
import { PlannerAgent } from './planner';
import { LiaisonAgent } from './liaison';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function testDirect() {
  const dummyPath = path.resolve(process.cwd(), 'dummy_calendar.ics');
  const tasksPath = path.resolve(process.cwd(), 'tasks.json');
  
  const calendarSource = process.env.AIRBNB_CALENDAR_URL || dummyPath;
  const calendar = new CalendarAgent(calendarSource);
  const planner = new PlannerAgent(tasksPath);
  const liaison = new LiaisonAgent();

  console.log("🚀 Iniciando prueba de envío DIRECTO al bridge...");

  try {
    const slots = await calendar.findAvailableSlots(30);
    const scheduled = planner.schedule(slots);
    
    // Buscar la tarea del tester
    const testTask = scheduled.find(s => s.task.providerId === 'tester');

    if (testTask) {
      console.log(`[1/3] Tarea encontrada: ${testTask.task.title}`);
      
      console.log("[2/3] Generando mensaje con IA...");
      const message = await liaison.generateProviderMessage(testTask);
      console.log("Mensaje generado:");
      console.log("------------------------------------");
      console.log(message);
      console.log("------------------------------------");

      console.log("[3/3] Enviando directamente al puente de WhatsApp (Puerto 3001)...");
      const success = await liaison.sendMessage('tester', message);
      
      if (success) {
        console.log("✅ ¡Prueba completada! Revisa el WhatsApp del número 56995005664.");
      } else {
        console.log("❌ El envío falló. El puente de WhatsApp puede no estar respondiendo.");
      }
    } else {
      console.log("❌ No se encontró la tarea de test en la planificación.");
    }

  } catch (err) {
    console.error("Error en la prueba:", err);
  }
}

testDirect();
