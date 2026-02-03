#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import process from "node:process";

const socketPath = process.env.NETDEV_SOCKET ?? process.argv[2];

if (!socketPath) {
    console.error("Usage: mitm-netdev-sniff.mjs <unix-socket-path>");
    console.error("Set NETDEV_SOCKET to override.");
    process.exit(1);
}

if (!fs.existsSync(socketPath)) {
    console.error(`Socket not found: ${socketPath}`);
    process.exit(1);
}

const client = net.createConnection(socketPath);

client.on("connect", () => {
    console.log(`Connected to ${socketPath}`);
});

client.on("error", (error) => {
    console.error("Socket error:", error.message);
    process.exit(1);
});

client.on("data", (chunk) => {
    logFrame(chunk);
});

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
