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
const allowedDomains = new Set(
    (process.env.ALLOWED_DOMAINS ?? "example.com")
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
);
const dnsResponseIp = process.env.DNS_RESPONSE_IP ?? hostIp;

const hostIpBytes = ipToBytes(hostIp);
const hostMacBytes = macToBytes(hostMac);
const dnsResponseIpBytes = ipToBytes(dnsResponseIp);

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

    if (protocol === 17) {
        handleUdp(frame, sourceMac, sourceIp, destIp, ipOffset, ihl, totalLength);
        return;
    }

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

function handleUdp(frame, sourceMac, sourceIp, destIp, ipOffset, ihl, totalLength) {
    const udpOffset = ipOffset + ihl;
    if (frame.length < udpOffset + 8) {
        return;
    }

    const sourcePort = frame.readUInt16BE(udpOffset);
    const destPort = frame.readUInt16BE(udpOffset + 2);
    const length = frame.readUInt16BE(udpOffset + 4);
    const payloadStart = udpOffset + 8;
    const payloadEnd = Math.min(payloadStart + length - 8, ipOffset + totalLength, frame.length);

    if (payloadEnd <= payloadStart) {
        return;
    }

    if (destPort === 67) {
        if (!destIp.equals(hostIpBytes) && !isBroadcastIp(destIp)) {
            return;
        }
        const payload = frame.subarray(payloadStart, payloadEnd);
        handleDhcp(payload, sourceMac, sourceIp, destIp, sourcePort, destPort);
        return;
    }

    if (destPort === 53) {
        if (!destIp.equals(hostIpBytes) && !isBroadcastIp(destIp)) {
            return;
        }
        const payload = frame.subarray(payloadStart, payloadEnd);
        handleDns(payload, sourceMac, sourceIp, sourcePort);
    }
}

function handleDhcp(payload, sourceMac, _sourceIp, _destIp) {
    if (payload.length < 240) {
        return;
    }

    const op = payload[0];
    const hlen = payload[2];
    const xid = payload.readUInt32BE(4);
    const flags = payload.readUInt16BE(10);

    if (op !== 1 || hlen !== 6) {
        return;
    }

    const cookie = payload.readUInt32BE(236);
    if (cookie !== 0x63825363) {
        return;
    }

    const options = parseDhcpOptions(payload.subarray(240));
    const messageType = options.messageType;
    const requestedIp = options.requestedIp;

    if (!messageType) {
        return;
    }

    const offerIp = ipToBytes("192.168.100.2");

    if (messageType === 1) {
        const reply = buildDhcpReply({
            messageType: 2,
            xid,
            flags,
            clientMac: sourceMac,
            yiaddr: offerIp,
        });
        sendDhcpFrame(reply, sourceMac);
        console.log("DHCP offer -> 192.168.100.2");
        return;
    }

    if (messageType === 3) {
        if (requestedIp && !requestedIp.equals(offerIp)) {
            console.log(`DHCP request for ${formatIp(requestedIp)} ignored`);
            return;
        }

        const reply = buildDhcpReply({
            messageType: 5,
            xid,
            flags,
            clientMac: sourceMac,
            yiaddr: offerIp,
        });
        sendDhcpFrame(reply, sourceMac);
        console.log("DHCP ack -> 192.168.100.2");
    }
}

function handleDns(payload, sourceMac, sourceIp, sourcePort) {
    const query = parseDnsQuery(payload);
    if (!query) {
        return;
    }

    const domain = query.name.toLowerCase();
    const isAllowed = allowedDomains.has(domain);

    if (!isAllowed) {
        const response = buildDnsResponse(query, { rcode: 3 });
        sendDnsFrame(response, sourceMac, sourceIp, sourcePort);
        console.log(`DNS blocked -> ${domain}`);
        return;
    }

    if (query.qtype !== 1 || query.qclass !== 1) {
        const response = buildDnsResponse(query, { rcode: 0 });
        sendDnsFrame(response, sourceMac, sourceIp, sourcePort);
        console.log(`DNS no-answer -> ${domain}`);
        return;
    }

    const response = buildDnsResponse(query, { rcode: 0, answerIp: dnsResponseIpBytes });
    sendDnsFrame(response, sourceMac, sourceIp, sourcePort);
    console.log(`DNS allow -> ${domain} (${dnsResponseIp})`);
}

function parseDnsQuery(payload) {
    if (payload.length < 12) {
        return null;
    }

    const id = payload.readUInt16BE(0);
    const flags = payload.readUInt16BE(2);
    const qdcount = payload.readUInt16BE(4);

    if (qdcount < 1) {
        return null;
    }

    let offset = 12;
    const labels = [];

    while (offset < payload.length) {
        const length = payload[offset];
        if (length === 0) {
            offset += 1;
            break;
        }
        if ((length & 0xc0) !== 0) {
            return null;
        }
        offset += 1;
        if (offset + length > payload.length) {
            return null;
        }
        labels.push(payload.subarray(offset, offset + length).toString("ascii"));
        offset += length;
    }

    if (offset + 4 > payload.length) {
        return null;
    }

    const qtype = payload.readUInt16BE(offset);
    const qclass = payload.readUInt16BE(offset + 2);
    offset += 4;

    const question = payload.subarray(12, offset);

    return {
        id,
        rd: (flags & 0x0100) !== 0,
        name: labels.join("."),
        qtype,
        qclass,
        question,
    };
}

function buildDnsResponse(query, { rcode, answerIp }) {
    const flags = 0x8000 | (query.rd ? 0x0100 : 0) | (rcode & 0x000f);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(query.id, 0);
    header.writeUInt16BE(flags, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(answerIp ? 1 : 0, 6);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(0, 10);

    if (!answerIp) {
        return Buffer.concat([header, query.question]);
    }

    const answer = Buffer.alloc(16);
    answer.writeUInt16BE(0xc00c, 0);
    answer.writeUInt16BE(1, 2);
    answer.writeUInt16BE(1, 4);
    answer.writeUInt32BE(60, 6);
    answer.writeUInt16BE(4, 10);
    answerIp.copy(answer, 12);

    return Buffer.concat([header, query.question, answer]);
}

function sendDnsFrame(payload, clientMac, clientIp, clientPort) {
    const udpLength = 8 + payload.length;
    const ipLength = 20 + udpLength;

    const udpHeader = Buffer.alloc(8);
    udpHeader.writeUInt16BE(53, 0);
    udpHeader.writeUInt16BE(clientPort, 2);
    udpHeader.writeUInt16BE(udpLength, 4);
    udpHeader.writeUInt16BE(0, 6);

    const ipHeader = Buffer.alloc(20);
    ipHeader.writeUInt8(0x45, 0);
    ipHeader.writeUInt8(0, 1);
    ipHeader.writeUInt16BE(ipLength, 2);
    ipHeader.writeUInt16BE(0, 4);
    ipHeader.writeUInt16BE(0, 6);
    ipHeader.writeUInt8(64, 8);
    ipHeader.writeUInt8(17, 9);
    hostIpBytes.copy(ipHeader, 12);
    clientIp.copy(ipHeader, 16);
    ipHeader.writeUInt16BE(0, 10);
    const ipChecksum = computeChecksum(ipHeader);
    ipHeader.writeUInt16BE(ipChecksum, 10);

    const ethernet = Buffer.alloc(14);
    clientMac.copy(ethernet, 0);
    hostMacBytes.copy(ethernet, 6);
    ethernet.writeUInt16BE(0x0800, 12);

    const frame = Buffer.concat([ethernet, ipHeader, udpHeader, payload]);
    sendFrame(frame);
}

function parseDhcpOptions(buffer) {
    let offset = 0;
    let messageType;
    let requestedIp;

    while (offset < buffer.length) {
        const code = buffer[offset++];
        if (code === 0) {
            continue;
        }
        if (code === 255) {
            break;
        }
        if (offset >= buffer.length) {
            break;
        }
        const length = buffer[offset++];
        if (offset + length > buffer.length) {
            break;
        }
        const value = buffer.subarray(offset, offset + length);
        offset += length;

        if (code === 53 && length === 1) {
            messageType = value[0];
        } else if (code === 50 && length === 4) {
            requestedIp = Buffer.from(value);
        }
    }

    return { messageType, requestedIp };
}

function buildDhcpReply({ messageType, xid, flags, clientMac, yiaddr }) {
    const bootp = Buffer.alloc(236, 0);
    bootp[0] = 2;
    bootp[1] = 1;
    bootp[2] = 6;
    bootp[3] = 0;
    bootp.writeUInt32BE(xid, 4);
    bootp.writeUInt16BE(0, 8);
    bootp.writeUInt16BE(flags, 10);
    bootp.writeUInt32BE(0, 12);
    yiaddr.copy(bootp, 16);
    hostIpBytes.copy(bootp, 20);
    bootp.writeUInt32BE(0, 24);
    clientMac.copy(bootp, 28);

    const options = buildDhcpOptions(messageType);
    const cookie = Buffer.from([0x63, 0x82, 0x53, 0x63]);
    return Buffer.concat([bootp, cookie, options]);
}

function buildDhcpOptions(messageType) {
    const lease = 3600;
    const options = [];

    options.push(Buffer.from([53, 1, messageType]));
    options.push(Buffer.from([54, 4, ...hostIpBytes]));
    options.push(Buffer.from([51, 4, (lease >> 24) & 0xff, (lease >> 16) & 0xff, (lease >> 8) & 0xff, lease & 0xff]));
    options.push(Buffer.from([1, 4, 255, 255, 255, 0]));
    options.push(Buffer.from([3, 4, ...hostIpBytes]));
    options.push(Buffer.from([6, 4, ...hostIpBytes]));
    options.push(Buffer.from([255]));

    return Buffer.concat(options);
}

function sendDhcpFrame(payload, clientMac) {
    const udpPayloadLength = payload.length;
    const udpLength = 8 + udpPayloadLength;
    const ipLength = 20 + udpLength;

    const udpHeader = Buffer.alloc(8);
    udpHeader.writeUInt16BE(67, 0);
    udpHeader.writeUInt16BE(68, 2);
    udpHeader.writeUInt16BE(udpLength, 4);
    udpHeader.writeUInt16BE(0, 6);

    const ipHeader = Buffer.alloc(20);
    ipHeader.writeUInt8(0x45, 0);
    ipHeader.writeUInt8(0, 1);
    ipHeader.writeUInt16BE(ipLength, 2);
    ipHeader.writeUInt16BE(0, 4);
    ipHeader.writeUInt16BE(0, 6);
    ipHeader.writeUInt8(64, 8);
    ipHeader.writeUInt8(17, 9);
    hostIpBytes.copy(ipHeader, 12);
    ipHeader.writeUInt32BE(0xffffffff, 16);
    ipHeader.writeUInt16BE(0, 10);
    const ipChecksum = computeChecksum(ipHeader);
    ipHeader.writeUInt16BE(ipChecksum, 10);

    const ethernet = Buffer.alloc(14);
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]).copy(ethernet, 0);
    hostMacBytes.copy(ethernet, 6);
    ethernet.writeUInt16BE(0x0800, 12);

    const frame = Buffer.concat([ethernet, ipHeader, udpHeader, payload]);
    sendFrame(frame);
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

function isBroadcastIp(buffer) {
    return buffer.length === 4 && buffer[0] === 255 && buffer[1] === 255 && buffer[2] === 255 && buffer[3] === 255;
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
