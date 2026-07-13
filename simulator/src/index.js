'use strict';

const Device = require('./device');

const ACS_URL = process.env.MOCAACS_SIMULATOR_ACS_URL || 'http://moca-genieacs:7547';
const COUNT = parseInt(process.env.SIMULATOR_DEVICE_COUNT) || 10;

const MANUFACTURERS = ['HUAWEI', 'ZTE', 'FIBERHOME', 'CALIX'];
const MODELS = ['HG8245H', 'F680', 'AN5506-04-FA', 'GS2028E'];

console.log(`MOCA TR-069 Simulator — ${COUNT} dispositivos → ${ACS_URL}`);

for (let i = 0; i < COUNT; i++) {
  const oui = String(100000 + i).padStart(6, '0');
  const serial = String(200000 + i).padStart(8, '0');
  const mfr = MANUFACTURERS[i % MANUFACTURERS.length];
  const model = MODELS[i % MODELS.length];

  const device = new Device({
    id: `${oui}-${model}-${serial}`,
    manufacturer: mfr,
    model,
    serial,
    acsUrl: ACS_URL
  });

  // Escalonar los informs para no generar una avalancha
  setTimeout(() => device.start(), i * 500);
}
