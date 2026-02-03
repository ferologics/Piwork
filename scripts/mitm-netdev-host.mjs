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
const hostIp = process.env.HOST_IP ?? "192.168.100.1";
const hostMac = process.env.HOST_MAC ?? "02:50:00:00:00:01";
const logFrames = process.env.LOG_FRAMES === "1";

const hostIpBytes = ipToBytes(hostIp);
const hostMacBytes = macToBytes(hostMac);

await waitForSocket(socketPath, waitSeconds);

const client = net.createConnection(socketPath);
let pending = Buffer.alloc(0);

client.on("connect", () => {
    console.log(`Connected to ${socketPath}`);
    console.log(`Host IP ${hostIp}, MAC ${hostMac}`);
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
        handleFrame(frame);
        offset += 4 + frameLength;
    }

    return buffer.subarray(offset);
}

function handleFrame(frame) {
    if (frame.length < 14) {
        return;
    }

    const dest = frame.subarray(0, 6);
    const source = frame.subarray(6, 12);
    const etherType = frame.readUInt16BE(12);

    if (logFrames) {
        logFrame(frame);
    }

    if (etherType === 0x0806) {
        handleArp(frame, source);
        return;
    }

    if (etherType === 0x0800) {
        handleIpv4(frame, dest, source);
    }
}

function handleArp(frame) {
    if (frame.length < 42) {
        return;
    }

    const arpOffset = 14;
    const oper = frame.readUInt16BE(arpOffset + 6);
    const senderMac = frame.subarray(arpOffset + 8, arpOffset + 14);
    const senderIp = frame.subarray(arpOffset + 14, arpOffset + 18);
    const targetIp = frame.subarray(arpOffset + 24, arpOffset + 28);

    if (oper !== 1) {
        return;
    }

    if (!targetIp.equals(hostIpBytes)) {
        return;
    }

    const reply = buildArpReply(senderMac, senderIp);
    sendFrame(reply);
    console.log(`ARP reply -> ${formatIp(senderIp)}`);
}

function handleIpv4(frame, _destMac, sourceMac) {
    const ipOffset = 14;
    if (frame.length < ipOffset + 20) {
        return;
    }

    const versionIhl = frame[ipOffset];
    const ihl = (versionIhl & 0x0f) * 4;
    if (ihl < 20 || frame.length < ipOffset + ihl) {
        return;
    }

    const protocol = frame[ipOffset + 9];
    const sourceIp = frame.subarray(ipOffset + 12, ipOffset + 16);
    const destIp = frame.subarray(ipOffset + 16, ipOffset + 20);
    const totalLength = frame.readUInt16BE(ipOffset + 2);

    if (!destIp.equals(hostIpBytes)) {
        return;
    }

    if (protocol !== 1) {
        return;
    }

    const icmpOffset = ipOffset + ihl;
    if (frame.length < icmpOffset + 8) {
        return;
    }

    const icmpType = frame[icmpOffset];
    if (icmpType !== 8) {
        return;
    }

    const payloadEnd = Math.min(ipOffset + totalLength, frame.length);
    const icmpPayload = Buffer.from(frame.subarray(icmpOffset, payloadEnd));
    icmpPayload[0] = 0;
    icmpPayload[2] = 0;
    icmpPayload[3] = 0;
    const icmpChecksum = computeChecksum(icmpPayload);
    icmpPayload.writeUInt16BE(icmpChecksum, 2);

    const ipHeader = Buffer.from(frame.subarray(ipOffset, ipOffset + ihl));
    ipHeader.writeUInt8(64, 8);
    ipHeader.writeUInt16BE(ihl + icmpPayload.length, 2);
    hostIpBytes.copy(ipHeader, 12);
    sourceIp.copy(ipHeader, 16);
    ipHeader.writeUInt16BE(0, 10);
    const ipChecksum = computeChecksum(ipHeader);
    ipHeader.writeUInt16BE(ipChecksum, 10);

    const ethernet = Buffer.alloc(14);
    sourceMac.copy(ethernet, 0);
    hostMacBytes.copy(ethernet, 6);
    ethernet.writeUInt16BE(0x0800, 12);

    const reply = Buffer.concat([ethernet, ipHeader, icmpPayload]);
    sendFrame(reply);
    console.log(`ICMP echo reply -> ${formatIp(sourceIp)}`);
}

function buildArpReply(senderMac, senderIp) {
    const frame = Buffer.alloc(14 + 28);
    senderMac.copy(frame, 0);
    hostMacBytes.copy(frame, 6);
    frame.writeUInt16BE(0x0806, 12);

    const arpOffset = 14;
    frame.writeUInt16BE(1, arpOffset);
    frame.writeUInt16BE(0x0800, arpOffset + 2);
    frame.writeUInt8(6, arpOffset + 4);
    frame.writeUInt8(4, arpOffset + 5);
    frame.writeUInt16BE(2, arpOffset + 6);
    hostMacBytes.copy(frame, arpOffset + 8);
    hostIpBytes.copy(frame, arpOffset + 14);
    senderMac.copy(frame, arpOffset + 18);
    senderIp.copy(frame, arpOffset + 24);

    return frame;
}

function sendFrame(frame) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(frame.length, 0);
    client.write(Buffer.concat([header, frame]));
}

function computeChecksum(buffer) {
    let sum = 0;

    for (let i = 0; i < buffer.length; i += 2) {
        let word = buffer[i] << 8;
        if (i + 1 < buffer.length) {
            word |= buffer[i + 1];
        }
        sum += word;
        while (sum > 0xffff) {
            sum = (sum & 0xffff) + (sum >> 16);
        }
    }

    return (~sum) & 0xffff;
}

function logFrame(frame) {
    const dest = formatMac(frame.subarray(0, 6));
    const source = formatMac(frame.subarray(6, 12));
    const etherType = frame.readUInt16BE(12);
    const typeLabel = etherType === 0x0800 ? "ipv4" : etherType === 0x0806 ? "arp" : "other";

    console.log(`Frame (${frame.length} bytes) ${typeLabel}`);
    console.log(`  dst=${dest} src=${source} type=0x${etherType.toString(16)}`);
}

function formatMac(buffer) {
    return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

function formatIp(buffer) {
    return [...buffer].join(".");
}

function ipToBytes(ip) {
    return Buffer.from(ip.split(".").map((part) => Number(part)));
}

function macToBytes(mac) {
    return Buffer.from(mac.split(":").map((part) => Number.parseInt(part, 16)));
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
