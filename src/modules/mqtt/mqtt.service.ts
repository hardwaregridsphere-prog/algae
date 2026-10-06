import mqtt, { MqttClient } from 'mqtt';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { MqttHandler } from './mqtt.handler';

export class MqttService {
  private client: MqttClient | null = null;
  private static instance: MqttService;

  private constructor() {}

  static getInstance(): MqttService {
    if (!MqttService.instance) {
      MqttService.instance = new MqttService();
      // Automatically trigger connection when instantiated
      MqttService.instance.connect();
    }
    return MqttService.instance;
  }

  connect() {
    // Using the MQTT_BROKER_URL we defined in src/config/env.ts
    const brokerUrl = env.MQTT_BROKER_URL;

    logger.info(`Connecting to EMQX at ${brokerUrl}...`);

    this.client = mqtt.connect(brokerUrl, {
      clientId: env.MQTT_CLIENT_ID,
      username: env.MQTT_USERNAME,
      password: env.MQTT_PASSWORD,
      clean: false,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      logger.info('MQTT Connected. Subscribing to device topics...');
      
      // Subscribing to all relevant topics required by the MqttHandler
      const topics = [
        'algaetree/+/telemetry',
        'algaetree/+/status',
        'algaetree/+/events',       // Updated from 'event' to 'events' to match our handler
        'algaetree/+/time/ack',     // Required for RTC sync
        'algaetree/+/schedule/ack', // Required for Schedule sync
        'algaetree/+/ota/progress'  // Required for OTA tracking
      ];
      
      this.client?.subscribe(topics, { qos: 1 }, (err) => {
        if (err) logger.error({ err }, 'MQTT Subscribe Error');
      });
    });

    this.client.on('message', async (topic, message) => {
      try {
        // Our updated MqttHandler expects the raw buffer so it can handle its own JSON parsing safely
        await MqttHandler.handleMessage(topic, message);
      } catch (error) {
        logger.error({ error, topic }, 'Failed to process MQTT message');
      }
    });

    this.client.on('error', (error) => logger.error({ error }, 'MQTT Client Error'));
    this.client.on('offline', () => logger.warn('MQTT Client Offline'));
    this.client.on('reconnect', () => logger.info('MQTT Reconnecting...'));
  }

  publish(topic: string, payload: any, qos: 0 | 1 | 2 = 1, retain = false) {
    if (!this.client?.connected) {
      logger.warn(`MQTT offline. Cannot publish to ${topic}`);
      return false;
    }
    this.client.publish(topic, JSON.stringify(payload), { qos, retain }, (err) => {
      if (err) logger.error({ err, topic }, 'MQTT Publish Error');
    });
    return true;
  }

  // === ADDED THIS DISCONNECT METHOD ===
  public async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client && this.client.connected) {
        // Close the connection cleanly without forcing an immediate hard drop
        this.client.end(false, {}, () => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}