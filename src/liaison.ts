import { execSync } from 'child_process';
import { ScheduledTask } from './planner';
import fs from 'fs';
import path from 'path';

export class LiaisonAgent {
  private providers: any;
  private sessionId: string;

  constructor() {
    this.sessionId = `airbnb-${Date.now()}`;
    const providersPath = path.resolve(process.cwd(), 'providers.json');
    if (fs.existsSync(providersPath)) {
      this.providers = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
    } else {
      this.providers = {};
    }
  }

  async generateProviderMessage(scheduled: ScheduledTask): Promise<string> {
    const providerInfo = this.providers[scheduled.task.providerId] || { name: scheduled.task.providerId };

    const prompt = `
      Eres un asistente de gestión de Airbnb. 
      Tu tarea es redactar un mensaje corto, profesional y amable para un proveedor de servicios.
      
      Detalles del trabajo:
      - Tarea: ${scheduled.task.title}
      - Nombre del Proveedor: ${providerInfo.name}
      - Fecha de inicio: ${scheduled.start.toLocaleString()}
      - Fecha de fin: ${scheduled.end.toLocaleString()}
      
      Escribe un mensaje listo para enviar por WhatsApp. 
      SÓLO escribe el texto del mensaje. 
      NO uses etiquetas XML, NO uses <message>, NO uses <function>. 
      No incluyas explicaciones adicionales, solo el texto plano del mensaje.
    `.trim();

    try {
      const escapedPrompt = prompt.replace(/"/g, '\\"');
      // Usar sesión única por mensaje para garantizar 0 tokens de historial
      const sessionId = `airbnb-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const command = `docker exec nanobot nanobot agent -s "${sessionId}" -m "${escapedPrompt}" --no-markdown`;
      const output = execSync(command, { encoding: 'utf-8' });
      // Limpiar el resultado quitando comillas iniciales/finales y espacios
      return output.trim().replace(/^["']|["']$/g, '');
    } catch (error) {
      console.error("Error al generar mensaje con Nanobot:", error);
      return `Hola ${providerInfo.name}, te escribo para coordinar la tarea: ${scheduled.task.title} para el ${scheduled.start.toLocaleString()}. ¿Confirmas disponibilidad?`;
    }
  }

  /**
   * Envía un mensaje directamente al puente de WhatsApp (Baileys Bridge) de Nanobot
   */
  async sendMessage(providerId: string, content: string): Promise<boolean> {
    const provider = this.providers[providerId];
    if (!provider || !provider.phone) {
      console.error(`No se encontró información de contacto para: ${providerId}`);
      return false;
    }

    const jid = `${provider.phone}@s.whatsapp.net`;
    console.log(`[Liaison] Enviando mensaje a ${provider.name} (${jid})...`);

    return new Promise((resolve) => {
      const pythonScript = `
import asyncio
import websockets
import json
import sys

async def main():
    try:
        async with websockets.connect("ws://localhost:3001") as ws:
            await ws.send(json.dumps({"type": "send", "to": sys.argv[1], "text": sys.argv[2]}))
            await asyncio.sleep(1)
            print("OK")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(main())
`;
      const tempScriptPath = path.resolve(process.cwd(), 'temp-send-wa.py');
      fs.writeFileSync(tempScriptPath, pythonScript);

      try {
        const escapedContent = content.replace(/"/g, '\\"').replace(/\\n/g, '\\n');
        const command = `docker cp ${tempScriptPath} nanobot:/tmp/send-wa.py && docker exec nanobot python /tmp/send-wa.py "${jid}" "${escapedContent}"`;
        execSync(command, { stdio: 'ignore' });
        if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
        resolve(true);
      } catch (err) {
        console.error("Error conectando al puente de WhatsApp:", err);
        if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
        resolve(false);
      }
    });
  }

  /**
   * Espera la aprobación del propietario vía WhatsApp
   */
  async waitForApproval(ownerPhone: string, timeoutMinutes: number): Promise<boolean> {
    const jid = `${ownerPhone}@s.whatsapp.net`;
    console.log(`[Liaison] Esperando respuesta de ${ownerPhone} por máximo ${timeoutMinutes} minutos...`);

    return new Promise((resolve) => {
      const pythonScript = `
import asyncio
import websockets
import json
import sys

async def main():
    try:
        async with websockets.connect("ws://localhost:3001") as ws:
            while True:
                response = await ws.recv()
                data = json.loads(response)
                
                if data.get("type") == "message":
                    msg = data.get("content", "")
                    sender = data.get("sender", "")
                    
                    text = str(msg).lower().strip()
                    
                    owner_phone = sys.argv[1].split('@')[0]
                    owner_jid = "${process.env.OWNER_JID}"
                    if not owner_jid or owner_jid == "undefined":
                        print("ERROR: OWNER_JID not configured")
                        return
                    if owner_phone in sender or sender == owner_jid:
                        if text in ["si", "sí", "ok", "yes", "apruebo", "dale", "envialo", "enviar"]:
                            print("APPROVED")
                            return
                        elif text in ["no", "cancela", "cancelar", "detener"]:
                            print("REJECTED")
                            return
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(main())
`;
      const tempScriptPath = path.resolve(process.cwd(), 'temp-listen-wa.py');
      fs.writeFileSync(tempScriptPath, pythonScript);

      try {
        const command = `docker cp ${tempScriptPath} nanobot:/tmp/listen-wa.py && docker exec nanobot timeout ${timeoutMinutes * 60} python /tmp/listen-wa.py "${jid}"`;
        const output = execSync(command, { encoding: 'utf-8' });
        if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);

        if (output.includes("APPROVED")) {
          resolve(true);
        } else {
          resolve(false);
        }
      } catch (err: any) {
        if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
        if (err.status === 124) {
          console.log(`[Liaison] Tiempo de espera agotado (${timeoutMinutes} min).`);
        } else {
          console.error("Error escuchando respuesta de WhatsApp:", err.message);
        }
        resolve(false);
      }
    });
  }

  /**
   * Escucha un comando específico ("scan", "tasks", etc) del propietario
   */
  async listenForCommand(ownerJid: string, keyword: string): Promise<boolean> {
    return new Promise((resolve) => {
      const pythonScript = `
import asyncio
import websockets
import json
import sys

async def main():
    try:
        async with websockets.connect("ws://localhost:3001") as ws:
            while True:
                response = await ws.recv()
                data = json.loads(response)
                if data.get("type") == "message":
                    msg = str(data.get("content", "")).lower().strip()
                    sender = data.get("sender", "")
                    if sys.argv[1] in sender and sys.argv[2] in msg:
                        print("TRIGGERED")
                        return
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(main())
`;
      const tempScriptPath = path.resolve(process.cwd(), 'temp-command-wa.py');
      fs.writeFileSync(tempScriptPath, pythonScript);

      try {
        const command = `docker cp ${tempScriptPath} nanobot:/tmp/command-wa.py && docker exec nanobot python /tmp/command-wa.py "${ownerJid}" "${keyword}"`;
        const output = execSync(command, { encoding: 'utf-8' });
        if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
        if (output.includes("TRIGGERED")) resolve(true);
        else resolve(false);
      } catch (err) {
        if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
        resolve(false);
      }
    });
  }
}
