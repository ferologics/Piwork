#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const tmpDir = process.env.TMP_DIR ?? path.join(rootDir, "tmp");

fs.mkdirSync(tmpDir, { recursive: true });

const socketPath = process.env.NETDEV_SOCKET ?? process.argv[2] ?? path.join(tmpDir, "piwork-netdev.sock");
const waitSeconds = Number(process.env.WAIT_FOR_SOCKET ?? 10);
const maxFrameSize = Number(process.env.MAX_FRAME_SIZE ?? 65535);

await waitForSocket(socketPath, waitSeconds);

const client = net.createConnection(socketPath);
let pending = Buffer.alloc(0);

client.on("connect", () => {
    console.log(`Connected to ${socketPath}`);
});

client.on("error", (error) => {
    console.error("Socket error:", error.message);
    process.exit(1);
});

client.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    pending = drainFrames(pending);
});

function drainFrames(buffer) {
    let offset = 0;

    while (buffer.length - offset >= 4) {
        const frameLength = buffer.readUInt32BE(offset);

        if (frameLength > maxFrameSize) {
            console.error(`Frame length ${frameLength} exceeds max ${maxFrameSize}. Resetting buffer.`);
            return Buffer.alloc(0);
        }

        if (buffer.length - offset < 4 + frameLength) {
            break;
        }

        const frame = buffer.subarray(offset + 4, offset + 4 + frameLength);
        logFrame(frame);
        offset += 4 + frameLength;
    }

    return buffer.subarray(offset);
}

function logFrame(frame) {
    if (frame.length < 14) {
        console.log(`Frame (${frame.length} bytes):`, frame.toString("hex"));
        return;
    }

    const dest = formatMac(frame.subarray(0, 6));
    const source = formatMac(frame.subarray(6, 12));
    const etherType = frame.readUInt16BE(12);

    const typeLabel = etherType === 0x0800 ? "ipv4" : etherType === 0x0806 ? "arp" : "other";

    console.log(`Frame (${frame.length} bytes) ${typeLabel}`);
    console.log(`  dst=${dest} src=${source} type=0x${etherType.toString(16)}`);

    if (etherType === 0x0800 && frame.length >= 34) {
        const ipHeaderOffset = 14;
        const ipHeaderLength = (frame[ipHeaderOffset] & 0x0f) * 4;
        const protocol = frame[ipHeaderOffset + 9];
        const sourceIp = formatIp(frame.subarray(ipHeaderOffset + 12, ipHeaderOffset + 16));
        const destIp = formatIp(frame.subarray(ipHeaderOffset + 16, ipHeaderOffset + 20));

        console.log(`  ip ${sourceIp} -> ${destIp} proto=${protocol}`);

        if (protocol === 6 && frame.length >= ipHeaderOffset + ipHeaderLength + 4) {
            const tcpOffset = ipHeaderOffset + ipHeaderLength;
            const sourcePort = frame.readUInt16BE(tcpOffset);
            const destPort = frame.readUInt16BE(tcpOffset + 2);

            console.log(`  tcp ${sourcePort} -> ${destPort}`);
        }
    }
}

function formatMac(buffer) {
    return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

function formatIp(buffer) {
    return [...buffer].join(".");
}

async function waitForSocket(socketFile, seconds) {
    if (fs.existsSync(socketFile)) {
        return;
    }

    if (seconds <= 0) {
        console.error(`Socket not found: ${socketFile}`);
        process.exit(1);
    }

    console.log(`Waiting for socket: ${socketFile}`);

    const deadline = Date.now() + seconds * 1000;

    while (Date.now() < deadline) {
        if (fs.existsSync(socketFile)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.error(`Socket not found after ${seconds}s: ${socketFile}`);
    process.exit(1);
}
