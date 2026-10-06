export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Algae-Tree IoT Engine API',
    version: '1.0.0',
    description: 'Interactive API documentation for testing device provisioning and control.',
  },
  servers: [{ url: 'http://localhost:8000' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/api/auth/login': {
      post: {
        summary: 'Admin Login',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'admin@algaetree.com' },
                  password: { type: 'string', example: 'yourpassword' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Successful login. Returns JWT accessToken.' },
        },
      },
    },
    '/api/devices': {
      post: {
        summary: 'Provision a New Device',
        tags: ['Devices'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Simulated ESP32' },
                  timezone: { type: 'string', example: 'UTC' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Device created. Returns MQTT credentials.' },
        },
      },
    },
  },
};