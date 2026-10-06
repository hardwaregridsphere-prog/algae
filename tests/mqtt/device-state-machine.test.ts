    import { MqttHandler } from '../../src/modules/mqtt/mqtt.handler';
import { PrismaClient } from '@prisma/client';
import { SystemWorkers } from '../../src/workers/system.workers';

const prisma = new PrismaClient();

describe('MQTT Command State Machine & Timeout Verification', () => {
  const testUid = 'ALGAE-TEST-001';
  let deviceId: number;

  beforeAll(async () => {
    const device = await prisma.device.upsert({
      where: { device_uid: testUid },
      update: { status: 'ONLINE', actual_maintenance_mode: true },
      create: {
        device_uid: testUid,
        name: 'Test Pod',
        status: 'ONLINE',
        actual_maintenance_mode: true,
      },
    });
    deviceId = device.id;
  });

  it('Transition: SENT -> ACKNOWLEDGED on command_ack event', async () => {
    const reqId = `REQ-TEST-1`;
    await prisma.deviceCommand.create({
      data: {
        request_id: reqId,
        device_id: deviceId,
        command: 'relay',
        payload: { relay: 1, state: true },
        status: 'SENT',
      },
    });

    const eventPayload = Buffer.from(
      JSON.stringify({
        event: 'command_ack',
        request_id: reqId,
        device_uid: testUid,
      })
    );

    await MqttHandler.handleMessage(`algaetree/${testUid}/events`, eventPayload);

    const updated = await prisma.deviceCommand.findUnique({ where: { request_id: reqId } });
    expect(updated?.status).toBe('ACKNOWLEDGED');
    expect(updated?.acknowledged_at).not.toBeNull();
  });

  it('Transition: ACKNOWLEDGED -> EXECUTED with physical RelayState reflection', async () => {
    const reqId = `REQ-TEST-2`;
    await prisma.deviceCommand.create({
      data: {
        request_id: reqId,
        device_id: deviceId,
        command: 'relay',
        payload: { relay: 1, state: true },
        status: 'ACKNOWLEDGED',
      },
    });

    const eventPayload = Buffer.from(
      JSON.stringify({
        event: 'relay_executed',
        request_id: reqId,
        success: true,
        relay: 1,
        state: true,
        device_uid: testUid,
      })
    );

    await MqttHandler.handleMessage(`algaetree/${testUid}/events`, eventPayload);

    const updatedCmd = await prisma.deviceCommand.findUnique({ where: { request_id: reqId } });
    expect(updatedCmd?.status).toBe('EXECUTED');

    const relayState = await prisma.relayState.findUnique({
      where: { device_id_relay_number: { device_id: deviceId, relay_number: 1 } },
    });
    expect(relayState?.state).toBe(true);
  });

  it('Transition: PENDING/SENT -> TIMEOUT via Background Reliability Sweeper', async () => {
    const reqId = `REQ-TEST-TIMEOUT`;
    // Create command back-dated 30 seconds ago
    await prisma.deviceCommand.create({
      data: {
        request_id: reqId,
        device_id: deviceId,
        command: 'relay',
        payload: { relay: 2, state: true },
        status: 'SENT',
        created_at: new Date(Date.now() - 30000),
      },
    });

    const workers = new SystemWorkers();
    // Run one internal sweep manually
    await (workers as any).sweepCommandTimeouts();

    const timedOutCmd = await prisma.deviceCommand.findUnique({ where: { request_id: reqId } });
    expect(timedOutCmd?.status).toBe('TIMEOUT');
  });
});