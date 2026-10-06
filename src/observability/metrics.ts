export interface AppMetricsSnapshot {
  onlineDevices: number;
  offlineDevices: number;
  telemetryIngestedTotal: number;
  mqttMessagesReceivedTotal: number;
  mqttMessagesPublishedTotal: number;
  commandsExecutedTotal: number;
  commandsFailedTotal: number;
  commandsTimedOutTotal: number;
  apiRequestsTotal: number;
  apiErrorsTotal: number;
  activeAlerts: number;
  rtcInvalidDevices: number;
  otaFailuresTotal: number;
}

class MetricsRegistry {
  private static instance: MetricsRegistry;

  private telemetryIngested = 0;
  private mqttMessagesReceived = 0;
  private mqttMessagesPublished = 0;
  private commandsExecuted = 0;
  private commandsFailed = 0;
  private commandsTimedOut = 0;
  private apiRequests = 0;
  private apiErrors = 0;
  private otaFailures = 0;

  private constructor() {}

  public static getInstance(): MetricsRegistry {
    if (!MetricsRegistry.instance) {
      MetricsRegistry.instance = new MetricsRegistry();
    }
    return MetricsRegistry.instance;
  }

  public incrementTelemetry() { this.telemetryIngested++; }
  public incrementMqttReceived() { this.mqttMessagesReceived++; }
  public incrementMqttPublished() { this.mqttMessagesPublished++; }
  public incrementCommandExecuted() { this.commandsExecuted++; }
  public incrementCommandFailed() { this.commandsFailed++; }
  public incrementCommandTimedOut() { this.commandsTimedOut++; }
  public incrementApiRequests() { this.apiRequests++; }
  public incrementApiErrors() { this.apiErrors++; }
  public incrementOtaFailures() { this.otaFailures++; }

  public getSnapshot(dynamicGauges: {
    onlineDevices: number;
    offlineDevices: number;
    activeAlerts: number;
    rtcInvalidDevices: number;
  }): AppMetricsSnapshot {
    return {
      ...dynamicGauges,
      telemetryIngestedTotal: this.telemetryIngested,
      mqttMessagesReceivedTotal: this.mqttMessagesReceived,
      mqttMessagesPublishedTotal: this.mqttMessagesPublished,
      commandsExecutedTotal: this.commandsExecuted,
      commandsFailedTotal: this.commandsFailed,
      commandsTimedOutTotal: this.commandsTimedOut,
      apiRequestsTotal: this.apiRequests,
      apiErrorsTotal: this.apiErrors,
      otaFailuresTotal: this.otaFailures,
    };
  }
}

export const metrics = MetricsRegistry.getInstance();