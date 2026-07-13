
POST / HTTP/1.1

Host: 10.0.2.14:7547

User-Agent: BCM_TR69_CPE_04_00

Connection: keep-alive

SOAPAction:

Content-Type: text/xml

Content-Length: 3135

  

<SOAP-ENV:Envelope

xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"

xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"

xmlns:xsd="http://www.w3.org/2001/XMLSchema"

xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"

xmlns:cwmp="urn:dslforum-org:cwmp-1-0">

<SOAP-ENV:Header>

<cwmp:ID SOAP-ENV:mustUnderstand="1">819036283</cwmp:ID>

</SOAP-ENV:Header>

<SOAP-ENV:Body>

<cwmp:Inform>

<DeviceId>

<Manufacturer>Zhone</Manufacturer>

<OUI>000271</OUI>

<ProductClass>ZNID24xxA1</ProductClass>

<SerialNumber>5a4e545303a746a0</SerialNumber>

</DeviceId>

<Event SOAP-ENC:arrayType="cwmp:EventStruct[1]">

<EventStruct>

<EventCode>2 PERIODIC</EventCode>

<CommandKey></CommandKey>

</EventStruct>

</Event>

<MaxEnvelopes>1</MaxEnvelopes>

<CurrentTime>2026-06-06T09:48:52+00:00</CurrentTime>

<RetryCount>28</RetryCount>

<ParameterList SOAP-ENC:arrayType="cwmp:ParameterValueStruct[0008]">

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceSummary</Name>

<Value xsi:type="xsd:string">InternetGatewayDevice:1.4[](Baseline:1, EthernetLAN:1, Time:1, IPPing:1, DeviceAssociation:1, QoS:1, WiFiLAN:1, Download:1, Upload:1, DownloadTCP:1, UploadTCP:1, UDPEcho:1, UDPEchoPlus:1) , VoiceService:1.0[1](Endpoint:1, SIPEndpoint:1)</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.SpecVersion</Name>

<Value xsi:type="xsd:string">1.0</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.HardwareVersion</Name>

<Value xsi:type="xsd:string">01</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.SoftwareVersion</Name>

<Value xsi:type="xsd:string">S4.1.224</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.ProvisioningCode</Name>

<Value xsi:type="xsd:string"></Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.ManagementServer.ConnectionRequestURL</Name>

<Value xsi:type="xsd:string">http://10.1.255.120:7547/</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.ManagementServer.ParameterKey</Name>

<Value xsi:type="xsd:string">(null)</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2.ExternalIPAddress</Name>

<Value xsi:type="xsd:string">10.1.255.120</Value>

</ParameterValueStruct>

</ParameterList>

</cwmp:Inform>

</SOAP-ENV:Body>

</SOAP-ENV:Envelope>

HTTP/1.1 401 Unauthorized

Content-Length: 12

WWW-Authenticate: Digest realm="GenieACS",qop="auth,auth-int",nonce="a46261bbe5b8c04b61a78a21383b9b0d"

Date: Sat, 06 Jun 2026 15:02:27 GMT

Connection: keep-alive

  

Unauthorized

POST / HTTP/1.1

Host: 10.0.2.14:7547

User-Agent: BCM_TR69_CPE_04_00

Connection: keep-alive

Authorization: Digest username="admin", realm="GenieACS", algorithm="MD5", qop="auth", uri="/", nonce="a46261bbe5b8c04b61a78a21383b9b0d", cnonce="NzM5MzMyAA==", nc=00000001, response="82f0d2e4b36d6a011993459b47614daf"

SOAPAction:

Content-Type: text/xml

Content-Length: 3136

  

<SOAP-ENV:Envelope

xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"

xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"

xmlns:xsd="http://www.w3.org/2001/XMLSchema"

xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"

xmlns:cwmp="urn:dslforum-org:cwmp-1-0">

<SOAP-ENV:Header>

<cwmp:ID SOAP-ENV:mustUnderstand="1">2013078873</cwmp:ID>

</SOAP-ENV:Header>

<SOAP-ENV:Body>

<cwmp:Inform>

<DeviceId>

<Manufacturer>Zhone</Manufacturer>

<OUI>000271</OUI>

<ProductClass>ZNID24xxA1</ProductClass>

<SerialNumber>5a4e545303a746a0</SerialNumber>

</DeviceId>

<Event SOAP-ENC:arrayType="cwmp:EventStruct[1]">

<EventStruct>

<EventCode>2 PERIODIC</EventCode>

<CommandKey></CommandKey>

</EventStruct>

</Event>

<MaxEnvelopes>1</MaxEnvelopes>

<CurrentTime>2026-06-06T09:48:52+00:00</CurrentTime>

<RetryCount>28</RetryCount>

<ParameterList SOAP-ENC:arrayType="cwmp:ParameterValueStruct[0008]">

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceSummary</Name>

<Value xsi:type="xsd:string">InternetGatewayDevice:1.4[](Baseline:1, EthernetLAN:1, Time:1, IPPing:1, DeviceAssociation:1, QoS:1, WiFiLAN:1, Download:1, Upload:1, DownloadTCP:1, UploadTCP:1, UDPEcho:1, UDPEchoPlus:1) , VoiceService:1.0[1](Endpoint:1, SIPEndpoint:1)</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.SpecVersion</Name>

<Value xsi:type="xsd:string">1.0</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.HardwareVersion</Name>

<Value xsi:type="xsd:string">01</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.SoftwareVersion</Name>

<Value xsi:type="xsd:string">S4.1.224</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.DeviceInfo.ProvisioningCode</Name>

<Value xsi:type="xsd:string"></Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.ManagementServer.ConnectionRequestURL</Name>

<Value xsi:type="xsd:string">http://10.1.255.120:7547/</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.ManagementServer.ParameterKey</Name>

<Value xsi:type="xsd:string">(null)</Value>

</ParameterValueStruct>

<ParameterValueStruct>

<Name>InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2.ExternalIPAddress</Name>

<Value xsi:type="xsd:string">10.1.255.120</Value>

</ParameterValueStruct>

</ParameterList>

</cwmp:Inform>

</SOAP-ENV:Body>

</SOAP-ENV:Envelope>

HTTP/1.1 401 Unauthorized

Content-Length: 12

Connection: close

Date: Sat, 06 Jun 2026 15:02:27 GMT

  

Unauthorized