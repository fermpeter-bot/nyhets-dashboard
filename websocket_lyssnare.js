/**
 * TEORETISKT EXEMPEL: Så här tjuvlyssnar en backend på en nyhetssajt via WebSockets.
 * 
 * För att köra detta i verkligheten skulle man behöva:
 * 1. Node.js installerat på en server.
 * 2. Installera websocket-biblioteket (npm install ws).
 * 3. Hitta den faktiska wss:// adressen som tidningen använder.
 */

const WebSocket = require('ws');
const http = require('http'); // Lade till HTTP för Render.com
const fs = require('fs');
const path = require('path');

// 1. Skapa en enkel webbserver (Krävs för att Render ska veta att appen lever)
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        // Servera vår React-dashboard
        fs.readFile(path.join(__dirname, 'nyhetsdashboard.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Kunde inte ladda dashboarden.');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
    } else if (req.url === '/favicon.ico') {
        // Ignorera webbläsarens sökning efter ikon så vi slipper felmeddelanden
        res.writeHead(204);
        res.end();
    } else {
        res.writeHead(404);
        res.end('Sidan hittades inte');
    }
});

// 2. Skapa VÅR EGEN WebSocket-server för att skicka vidare data till Dashboarden
const wss = new WebSocket.Server({ server });

// Konfiguration för de tre stora aktörerna
const MEDIA_SOURCES = [
    {
        name: "Aftonbladet",
        url: "wss://live.aftonbladet.se/news-ws",
        subscribeMsg: { action: "join", room: "breaking_news" }
    },
    {
        name: "Expressen",
        url: "wss://push.expressen.se/realtime",
        subscribeMsg: { type: "subscribe", channel: "flash" }
    },
    {
        name: "SVT Nyheter",
        url: "wss://api.svt.se/nyheter-ws/live",
        subscribeMsg: { cmd: "listen", topic: "vma_and_flashes" }
    }
];

console.log('[System] Startar tjuvlyssnare för flera medier...\n');

// 2. Vi skapar en funktion som hanterar en enskild tidning
function connectToSource(source) {
    console.log(`[${source.name}] Försöker ansluta till ${source.url}...`);
    
    // NYTT: Vi lägger till headers så vi "låtsas" vara en vanlig webbläsare. 
    // Detta förhindrar att nyhetssajternas brandväggar (som Cloudflare) blockerar oss.
    const ws = new WebSocket(source.url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });

    // Vad som händer när vi lyckas ansluta till just denna källa
    ws.on('open', function open() {
        console.log(`[${source.name}] Ansluten! Lyssnar efter flashar...`);
        
        // Skicka eventuellt prenumerationsmeddelande om källan kräver det
        if (source.subscribeMsg) {
            ws.send(JSON.stringify(source.subscribeMsg));
        }
    });

    // Vad som händer när just denna källa skickar ut nyhetsdata
    ws.on('message', function incoming(data) {
        try {
            // NYTT: Konvertera data.toString() innan vi parsar. 
            // Förhindrar kraschar om datan kommer som en rå Buffer från ws-biblioteket.
            const parsedData = JSON.parse(data.toString());

            // Filtrera ut flasharna
            if (parsedData.type === 'FLASH' || parsedData.isBreakingNews === true) {
                
                const flash = {
                    source: source.name, // Nu använder vi källans riktiga namn dynamiskt
                    headline: parsedData.title,
                    url: parsedData.articleUrl,
                    timestamp: new Date().toLocaleTimeString('sv-SE')
                };

                console.log('\n🚨 NY FLASH UPPTÄCKT! 🚨');
                console.log(`[${flash.timestamp}] ${flash.source}: ${flash.headline}`);
                console.log(`Länk: ${flash.url}\n`);

                // SKICKA TILL DASHBOARDEN: Skicka flashen till alla webbläsare som har din dashboard öppen
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(flash));
                    }
                });
            }

        } catch (error) {
            // Ignorera vanliga skräpmeddelanden (ping/pong) från servrarna
        }
    });

    // Hantera om anslutningen bryts
    ws.on('close', function close() {
        console.log(`[${source.name}] Anslutningen bröts. Försöker återansluta om 5 sekunder...`);
        setTimeout(() => connectToSource(source), 5000); // Enkel automatisk återanslutning
    });

    ws.on('error', function error(err) {
        console.error(`[${source.name}] Nätverksfel:`, err.message);
    });
}

// HÄR STARTAR VI ALLT: Loopa igenom våra tre källor och anslut till dem
MEDIA_SOURCES.forEach(source => {
    connectToSource(source);
});

// Starta servern på den port som Render tilldelar oss
server.listen(port, () => {
    console.log(`\n[System] Backend-servern är igång och lyssnar på port ${port}`);
    console.log(`[System] Redo att ta emot anslutningar från Dashboarden...\n`);
});
