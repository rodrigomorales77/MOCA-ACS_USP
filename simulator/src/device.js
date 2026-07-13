'use strict';

const http = require('http');
const { URL } = require('url');

class Device {
  constructor({ id, manufacturer, model, serial, acsUrl }) {
    this.id = id;
    this.manufacturer = manufacturer;
    this.model = model;
    this.serial = serial;
    this.acsUrl = acsUrl;
    this.informInterval = 120; // segundos
    this.cookie = null;
  }

  buildInformSoap() {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <SOAP-ENV:Header>
    <cwmp:ID SOAP-ENV:mustUnderstand="1">1</cwmp:ID>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>${this.manufacturer}</Manufacturer>
        <OUI>${this.id.split('-')[0]}</OUI>
        <ProductClass>${this.model}</ProductClass>
        <SerialNumber>${this.serial}</SerialNumber>
      </DeviceId>
      <Event SOAP-ENC:arrayType="cwmp:EventStruct[1]"
             xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
        <EventStruct>
          <EventCode>0 BOOTSTRAP</EventCode>
          <CommandKey></CommandKey>
        </EventStruct>
      </Event>
      <MaxEnvelopes>1</MaxEnvelopes>
      <CurrentTime>${now}</CurrentTime>
      <RetryCount>0</RetryCount>
      <ParameterList SOAP-ENC:arrayType="cwmp:ParameterValueStruct[4]"
                     xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
        <ParameterValueStruct>
          <Name>InternetGatewayDevice.DeviceInfo.Manufacturer</Name>
          <Value xsi:type="xsd:string" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance">${this.manufacturer}</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>InternetGatewayDevice.DeviceInfo.ModelName</Name>
          <Value xsi:type="xsd:string" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance">${this.model}</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>InternetGatewayDevice.DeviceInfo.SerialNumber</Name>
          <Value xsi:type="xsd:string" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance">${this.serial}</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>InternetGatewayDevice.ManagementServer.PeriodicInformInterval</Name>
          <Value xsi:type="xsd:unsignedInt" xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance">${this.informInterval}</Value>
        </ParameterValueStruct>
      </ParameterList>
    </cwmp:Inform>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
  }

  async inform() {
    const url = new URL(this.acsUrl);
    const body = this.buildInformSoap();

    const headers = {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
      'Content-Length': Buffer.byteLength(body)
    };
    if (this.cookie) headers['Cookie'] = this.cookie;

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 7547,
        path: url.pathname || '/',
        method: 'POST',
        headers
      }, (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) this.cookie = setCookie[0].split(';')[0];
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  start() {
    console.log(`[${this.id}] Iniciando, ACS: ${this.acsUrl}`);
    const run = async () => {
      try {
        const code = await this.inform();
        console.log(`[${this.id}] Inform enviado → HTTP ${code}`);
      } catch (err) {
        console.error(`[${this.id}] Error: ${err.message}`);
      }
    };
    run();
    setInterval(run, this.informInterval * 1000);
  }
}

module.exports = Device;
