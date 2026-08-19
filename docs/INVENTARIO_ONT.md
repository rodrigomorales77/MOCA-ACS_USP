# Inventario de árboles TR-069 por modelo (Fase 2)

**Fecha:** 2026-08-19
**Relacionado:** [DISENO_ABSTRACCION_ONT.md](./DISENO_ABSTRACCION_ONT.md) (§14, Fase 2)
**Generación:** `tools/inventory/parse_tree.py` → volcados en `data/inventory/` (gitignoreado)

Este documento resume el análisis de las planillas exportadas de GenieACS para
soportar la Fase 3/4 del `ont-gateway`: definir el `catalog.json`, los perfiles de
mapping y los transformers.

> **Actualización 2026-08-19:** incorporado el **registro maestro de modelos**
> (`mapping/models.json`), que es la fuente de verdad de cobertura entre modelos de
> producción, perfiles y estado. La verificación contra el NBI de producción
> (3.886 dispositivos) detectó 2 modelos de caso borde no cubiertos (§8).

---

## 1. Fuentes de datos

Directorio `plantillas/` (9 archivos, 2 formatos de exportación):

| Archivo | Formato | Modelo detectado | Export |
|---|---|---|---|
| `device-model-ZNID2424A1.csv` | CSV estándar RFC 4180 | ZNID-GPON-2424A1-00 | Aug 8 |
| `device-model-ZNID2424.csv` | CSV estándar RFC 4180 | ZNID-GPON-2424 | Aug 8 |
| `device-model-ZNID2426A1.csv` | CSV estándar RFC 4180 | ZNID-GPON-2426A1-00 | Aug 8 |
| `device-model-ZNID2426A.csv` | CSV estándar RFC 4180 | ZNID-GPON-2426A-NA | Aug 8 |
| `tr-tree-2426a1.csv` | Legacy (filas envueltas en comillas) | ZNID-GPON-2426A1-00 | Jul 8 |
| `tr-tree-hs8145x6.csv` | Legacy (filas envueltas en comillas) | HS8145X6 | Jul 8 |
| `device-model-HS8145X6.csv` | CSV estándar RFC 4180 | HS8145X6 | Aug 11 |
| `device-model-F890L-ZXICC3AF3A12.csv` | CSV estándar RFC 4180 | F890L (ZXIC) | Jul 2 |
| `device-model-F890L-ZXICCADE0F12.csv` | CSV estándar RFC 4180 | F890L (ZXIC) | Aug 18 |

Ambos formatos comparten las mismas 12 columnas
(`Parameter, Object, ..., Writable, ..., Value, Value type, ..., Notification, ...`).
El parser distingue el formato automáticamente: el legacy envuelve cada fila en
comillas y reparte los valores multilínea (p. ej. `DeviceLog`) en varias líneas
físicas; el estándar es CSV RFC 4180 con header y multilínea nativa.

> **Importante:** el nombre de archivo NO identifica el modelo. `ZNID2426A.csv`
> contiene ProductClass `ZNID24xxA_GR` (ModelName `ZNID-GPON-2426A-NA`), y
> `ZNID2424A1` / `ZNID2426A1` comparten ProductClass `ZNID24xxA1`. El discriminador
> real es `DeviceInfo.ModelName`. Por eso los perfiles se nombran con ModelName.

## 2. Modelos cubiertos

Todos Zhone (OUI `000271`), árbol **TR-098 puro** (sin `Device.*`), un dispositivo
por archivo. Los `ZNID24xxA1-00` (2424A1/2426A1) y `ZNID24xx` usan serial
`5a4e...`; `2426A-NA` usa serial `ZNTS...`.

| ModelName | ProductClass | FW | HW | Params | W/RO |
|---|---|---|---|---|---|
| ZNID-GPON-2424A1-00 | ZNID24xxA1 | S4.1.037 | 01 | 3464 | 2312 / 1152 |
| ZNID-GPON-2424 | ZNID24xx | S3.0.733 | 02 | 3120 | 1833 / 1287 |
| ZNID-GPON-2426A1-00 | ZNID24xxA1 | S4.1.037 | 01 | 5082 | 3267 / 1815 |
| ZNID-GPON-2426A-NA | ZNID24xxA_GR | S3.1.375 | 01 | 4961 | 3287 / 1674 |

Huawei (referencia, ya analizado): HS8145X6, FW V5R021C00S050, TR-098, 3568 params.

El export `device-model-HS8145X6.csv` (Aug 11) es una **segunda unidad HS8145X6** (serial
`5A4E54533A01D993`, misma FW/HW) con **PPPoE activo y óptico poblado**, lo que cierra las
brechas de validación de Huawei (§5).

ZXIC/ZTE (F890L): 2 unidades exportadas (OUI `001146`), misma FW `V9.1.0P1T1` y HW `V9.0`.
La unidad `ZXICC3AF3A12` (Jul 2) tiene solo 39 params — export de registro sin datos
relevantes, subconjunto puro de la unidad completa. La unidad `ZXICCADE0F12` (Aug 18)
tiene 475 params y es la referencia para el perfil `ZXIC_F890L_TR098`.

## 3. Regenerar el inventario

```bash
python3 tools/inventory/parse_tree.py \
  plantillas/device-model-*.csv \
  plantillas/tr-tree-*.csv \
  --out data/inventory
```

Genera por perfil `.params.csv` + `.params.json`, más `index.json` y `analysis.md`
(cobertura del catálogo v1, feature-detect y comparación). Si dos archivos mapean
al mismo modelo (p. ej. `device-model-ZNID2426A1` y `tr-tree-2426a1`), el segundo
se nombra con sufijo del archivo fuente.

## 4. Matriz de features por modelo

| Feature | 2424A1 | 2424 | 2426A1 | 2426A | HS8145X6 | F890L (ZXIC) |
|---|---|---|---|---|---|---|
| WiFi 2.4G (`WLANConfiguration.1`) | — | — | sí (radio off) | sí (radio off) | sí | sí (SSID activo) |
| WiFi 5G (`WLANConfiguration.5`) | — | — | — | — | sí | sí (config.2/5) |
| GPON `*_String` (rx/tx/temp) | sí | **—** | sí | sí | — (otra ruta) | — |
| GPON crudo (`RxLevel`/`TxLevel`) | sí | sí | sí | sí | `X_GponInterafceConfig.*` **validado** | **—** (ausente) |
| `diagnostics.temperature` | sí | **—** | sí | sí | — | — |
| `X_BROADCOM_COM_XPON` (XPON/XGS-PON) | sí | — | sí | — | — | — |
| Diagnósticos transferencia (DL/UL) | sí | **—** | sí | sí | sí | — |
| Dot1x (`X_ZHONE_Dot1xPaeSystemObject`) | esqueleto | **completo (314)** | esqueleto | esqueleto | — | — |
| QueueManagement (colas QoS) | 23 | 19 | **471** | **470** | 32 | **—** |
| Bridge PPPoE activo (`LANDevice.N`) | 9 | 13 | 12 | 9 | — (WAN clásico) | — |
| `X_CMCC_*` (ext. China Mobile) | — | — | — | — | — | **93** |

## 5. Diferencias estructurales entre modelos

Las diferencias se agrupan en **3 ejes ortogonales**:

1. **Familia WiFi.** 2424A1/2424 no tienen radio (`LANWLANConfigurationNumberOfEntries=0`);
   2426A1/2426A tienen 1 radio 2.4G (`Enable=true`, `RadioEnabled=false`, SSID
   `Broadcom` por defecto, seguridad vacía, `PreSharedKey` write-only). Ninguno
   tiene 5 GHz.
2. **Línea de firmware.** A1 (`S4.1.037`): `X_BROADCOM_COM_XPON`, OmciSystem 46,
   `DUStateChangeComplPolicy`. 2424 (`S3.0.733`): Dot1x completo, sin XPON, sin
   CPU/mem ni diagnósticos de transferencia. 2426A (`S3.1.375`): monitores de
   sistema (CPU/Flash/Eth con umbrales), `X_ZHONE_COM_SFP` con óptica, `ManageableDevice`.
3. **Índices de instancia.** El bridge PPPoE activo vive en `LANDevice.9/13/12/9`
   según modelo; VLAN PPPoE 140/190/160/310. El mapping no puede fijar índice:
   se resuelve por `X_ZHONE_COM_PPPoEStatus.ConnectionStatus = Connected`.

Hay además ~2058 rutas comunes (de 6681 en la unión de los 4 ZNID); el grueso de
las diferencias es estado dinámico (Hosts DHCP, Stats, instancias de bridges) y
no estructura.

## 6. Cobertura del catálogo v1

| Canónico | Estado en los 4 ZNID |
|---|---|
| `device.*` (serial, mfr, modelo, hw, sw, uptime) | ✅ completo |
| `device.provisioning_code` | ✅ RW (vacío) |
| `lan.*` (IP, netmask, DHCP, DNS) | ✅ rutas idénticas |
| `wan.mode` | `X_ZHONE_COM_ConnectionType = IP_Bridged` |
| `wan.pppoe.username/password` | `LANDevice.N...X_ZHONE_COM_PPPoEConfig.*` (N variable) |
| `wan.nat.enabled` | `...IPInterface.1.X_ZHONE_COM_NATenabled` |
| `wan.ip/gateway/dns/status` | **no aplica**: equipos en bridge total (sin IP WAN) |
| `wifi.radio.2g.*` | solo 2426A1/2426A |
| `wifi.radio.5g.*` | no existe en la familia ZNID |
| `gpon.status` | `X_ZHONE_COM_GPON.GponOperStatus = Up` |
| `gpon.rx_power` / `gpon.tx_power` | `RxLevelString`/`TxLevelString` (dBm) — **ausente en 2424** (solo crudo) |
| `diagnostics.temperature` | `X_ZHONE_COM_GPON.TemperatureString` — ausente en 2424 |
| `diagnostics.cpu_usage` / `memory_usage` | `X_ZHONE_System.X_ZHONE_COM_Cpu0_Util` / `Memory_Average` — ausente en 2424 |
| `gpon.loid` / `gpon.distance` / `gpon.ploam` | **no existen** en ningún árbol |
| `actions.ping` | `IPPingDiagnostics` en los 4 |

### 6.1 Validación Huawei (export `device-model-HS8145X6`, Aug 11)

Cierra las brechas pendientes de §5: el snapshot trae **PPPoE conectado y óptico poblado**.

| Canónico | Ruta Huawei validada | Valor real |
|---|---|---|
| `wan.mode` | `WANConnectionDevice.1.WANPPPConnection.1.ConnectionType` | `IP_Routed` |
| `wan.status` | `...WANPPPConnection.1.ConnectionStatus` | `Connected` |
| `wan.ip` | `...WANPPPConnection.1.ExternalIPAddress` (RO) | `172.17.61.231` |
| `wan.pppoe.username` | `...WANPPPConnection.1.Username` (RW) | `juancarlosfelix` |
| `wan.pppoe.password` | `...WANPPPConnection.1.Password` (WO, vacío de vuelta) | — |
| `wan.nat.enabled` | `...WANPPPConnection.1.NATEnabled` | `true` |
| `wan.vlan_id` | `...WANPPPConnection.1.X_HW_VLAN` (instancia activa) | `145` |
| `gpon.status` | `WANDevice.1.X_GponInterafceConfig.Status` | `Up` |
| `gpon.rx_power` | `...X_GponInterafceConfig.RXPower` | `-17` (dBm) |
| `gpon.tx_power` | `...X_GponInterafceConfig.TXPower` | `2` (dBm) |
| `diagnostics.temperature` | `...X_GponInterafceConfig.TransceiverTemperature` | `38` (°C) |
| (extras) | `BiasCurrent=5` (mA), `SupplyVoltage=3338` (mV) | |

**Escalas confirmadas:** Huawei reporta potencias ópticas en **dBm entero** (RX puede ser
negativo, TX positivo) y temperatura en °C — *no* usa la escala ×0.1 dBm que el diseño §8.1
anticipaba. El transformer `dbm_milli_to_dbm` no aplica aquí; alcanza con parseo de entero.
`wan.vlan_id` vive en `X_HW_VLAN` de la instancia activa (PPPoE=145, IPoE=10), no en la ruta
estándar del WAN.

### 6.2 ZTE F890L (export `device-model-F890L-ZXICCADE0F12`, Aug 18)

| Canónico | Estado F890L |
|---|---|
| `device.*` | ✅ completo |
| `wan.mode` | `WANIPConnection.1` (IPoE, no bridge) |
| `wan.ip` | `ExternalIPAddress = 10.1.223.209` (RO) |
| `wan.pppoe.username` | `WANPPPConnection.1.Username` (RW, sin conexión activa) |
| `wifi.radio.2g.*` / `wifi.radio.5g.*` | SSIDs presentes (8 instancias, 2.4G+5G), pero `Enable`/`RadioEnabled` sin valor en el export |
| `gpon.*` | **completamente ausente** — ni una ruta PON/OMCI/GPON |
| `diagnostics.*` | **ausente** |
| `QueueManagement` | **ausente** |
| `IPPingDiagnostics` | **ausente** |

El F890L usa extensión vendor `X_CMCC_*` (China Mobile) con 93 params; no tiene
ninguna ruta de diagnóstico ni GPON expuesta vía TR-069. La exportación pequeña
(`ZXICC3AF3A12`, 39 params) es subconjunto puro de la grande — no aporta info nueva.

## 7. Hallazgos relevantes

- **WAN = bridge total.** LAN IP `0.0.0.0`, DHCP off, NAT false, sin WANIPConnection
  instanciado. El catálogo `wan.ip/gateway/dns` no tiene fuente en estos equipos
  (coherente con ONT de planta gestionadas por el OLT).
- **2424 es el "menos equipado":** sin GPON `*_String`, sin CPU/mem, sin WiFi, sin
  diagnósticos de transferencia, sin XPON. Requiere transformers/lecturas distintas
  para `gpon.rx_power` y `diagnostics.*`.
- **Exportación vieja vs nueva (mismo modelo 2426A1):** +109 params; la única
  diferencia estructural es el subárbol `WANDevice.*` (interfaces físicas Ethernet/GPON,
  ambas disabled) presente en la export nueva. No es cambio de firmware, es cobertura
  del export. Las dos unidades del mismo modelo son representativas entre sí.
- **Huawei viejo vs nuevo (HS8145X6):** sin diferencias estructurales (las 103 rutas solo
  en el viejo son estado dinámico: `AssociatedDevice`, Stats, Hosts; las 6 solo en el nuevo
  son `DeviceLog` y `ManageableDevice.1`). La export nueva aporta valores de PPPoE/óptico.
- **Seguridad:** las planillas contienen credenciales en claro (PPPoE `Password`,
  `ConnectionRequestPassword`, y una clave privada RSA en `CertificateCfg.1.PrivKey`).
  El parser las **enmascara** en los volcados (`[REDACTED]`); `plantillas/` no se
  commitea. No subir estos archivos a git.
- **ZTE F890L es el más básico en TR-069:** sin GPON, sin diagnósticos, sin
  QueueManagement, sin PingDiagnostics. WiFi con 8 SSIDs pero sin valores de
  Enable/RadioEnabled. Solo 3 valores WAN. Las extensión vendor `X_CMCC_*` (China
  Mobile) son las93 params escriturables más relevantes del modelo — posibles targets
  para configuración remota. La ONT tiene IPoE activo (no bridge como ZNID).

## 8. Registro maestro de modelos (`mapping/models.json`)

**Añadido:** 2026-08-19. **Schema:** `mapping/models.schema.json`.

El registro es la **fuente de verdad de cobertura**: relaciona cada modelo de
producción con su perfil de mapping y su estado. Se consulta junto con el catálogo
(parámetros) y los perfiles (rutas TR-069). Un modelo nuevo entra al registro con
`status: pending`; al exportar su plantilla y crear perfil pasa a `covered`.

### 8.1 Estados

| Estado | Significado |
|---|---|
| `covered` | Tiene perfil dedicado (o cubierto por el inventario) |
| `covered_family` | Cubierto por perfil unificado con feature-detect, sin plantilla propia |
| `partial_identity` | ProductClass visible en NBI pero ModelName no reportado (requiere refresh) |
| `pending` | En producción según el equipo; sin plantilla exportada ni perfil |
| `edge_case` | Unidad única documentada; fuera de alcance F4 |
| `inventory` | Tiene plantilla pero aún sin perfil |

### 8.2 Cobertura verificada contra NBI (snapshot 2026-08-19, 3.886 dispositivos)

| Fabricante | Modelo (NBI) | Unidades | Perfil | Estado |
|---|---|---|---|---|
| ZHONE | ZNID-GPON-2424A1-00 | 1.240 | `ZHONE_TR098` | `covered` |
| ZHONE | ZNID-GPON-2424 | 17 | `ZHONE_TR098` | `covered` |
| ZHONE | ZNID-GPON-2426A1-00 | 51 | `ZHONE_TR098` | `covered` |
| ZHONE | ZNID-GPON-2426A-NA | 97 | `ZHONE_TR098` | `covered` |
| ZHONE | ZNID-GPON-2424A / 2424A1 / 2426A1-00-NA / 2426A1-NA / 2426A-00 / 2426A1 | 5/5/17/15/22/1 | `ZHONE_TR098` | `covered_family` |
| ZHONE | ZNID24xxA1 / ZNID24xxA_GR / ZNID24xx (ProductClass) | 1.889/243/30 | `ZHONE_TR098` | `partial_identity` |
| HUAWEI | HS8145X6 | 247 | `HUAWEI_HS8145X6_TR098` | `covered` |
| HUAWEI | AG1729 / AG1720 / HG8546M / HG8310M | no en NBI | — | `pending` |
| HUAWEI | EG8041X6-10 | 1 | — | `edge_case` |
| HWTC | BM443GAX4 | 1 | — | `edge_case` |
| ZXIC | F890L | 2 | `ZXIC_F890L_TR098` | `covered` |

### 8.3 Casos borde (documentados, sin perfil)

Dos modelos detectados en producción con **1 unidad cada uno**, fuera del alcance
de F4 y sin plantilla exportada:

| Modelo | Fabricante (DeviceId) | Observación |
|---|---|---|
| `EG8041X6-10` | HUAWEI | ONT Huawei enterprise (serie EG), probablemente de prueba |
| `BM443GAX4` | HWTC | `HWTC` es el nombre corto de Huawei en el DeviceId; modelo sin presencia en el inventario |

No se crea perfil para ellos: son unidades únicas y el costo de un perfil dedicado
no se justifica. Quedan registrados para trazabilidad si la flota crece.

### 8.4 Modelos pendientes (brecha)

Los 4 Huawei `AG1729`, `AG1720`, `HG8546M`, `HG8310M` figuran como producción
según el equipo pero **no aparecen en el snapshot NBI** y no tienen plantilla
exportada. Para cerrar la brecha: exportar la plantilla de cada modelo (o al menos
un `tr-tree` de referencia) y evaluar si comparten el árbol de `HS8145X6` antes de
decidir perfil propio.

## 9. Conclusión para F3/F4

Los 4 modelos ZNID comparten plataforma Zhone/Broadcom TR-098 y rutas de catálogo
casi idénticas. **Se recomienda un solo perfil de mapping `ZHONE_TR098` con
feature-detect** (presencia de `WLANConfiguration.1`, `RxLevelString`,
`Cpu0_Util`, e índice del bridge PPPoE por `ConnectionStatus`), en lugar de 4
perfiles. La alternativa "2 perfiles (con/sin WiFi)" no elimina las condiciones:
2424 es el único sin WiFi, pero también le faltan `gpon.rx_power` (sin `*_String`)
y `diagnostics.cpu_util`, que habría que condicionar igual dentro de su perfil.
El feature-detect es necesario en cualquier esquema.

Huawei HS8145X6 tiene su propio perfil (`HUAWEI_HS8145X6_TR098`): WAN clásico con
PPPoE/IPoE, óptico vía `X_GponInterafceConfig`, WiFi 2.4G+5G. Escalas confirmadas
(dBm entero, °C). Ya validado en §6.1.

ZTE F890L requiere un tercer perfil (`ZXIC_F890L_TR098`): extensión vendor `X_CMCC_*`,
sin GPON/diagnósticos, WiFi 6 con 8 SSIDs, IPoE activo. Es el más limitado en
TR-069 pero potencialmente el más configurable vía `X_CMCC_*` (93 params RW).

**Catálogo de perfiles resultante para F4:**
- `ZHONE_TR098` (ZNID 2424A1/2424/2426A1/2426A) — feature-detect
- `HUAWEI_HS8145X6_TR098` (HS8145X6) — validado
- `ZXIC_F890L_TR098` (F890L) — WiFi 6, X_CMCC, sin GPON

Esto no modifica `DISENO_ABSTRACCION_ONT.md` (pendiente de revisión del equipo);
si la revisión cambia decisiones, se ajusta este inventario y el perfil en F4.
