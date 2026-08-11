# Inventario de árboles TR-069 por modelo (Fase 2)

**Fecha:** 2026-08-08
**Relacionado:** [DISENO_ABSTRACCION_ONT.md](./DISENO_ABSTRACCION_ONT.md) (§14, Fase 2)
**Generación:** `tools/inventory/parse_tree.py` → volcados en `data/inventory/` (gitignoreado)

Este documento resume el análisis de las planillas exportadas de GenieACS para
soportar la Fase 3/4 del `ont-gateway`: definir el `catalog.json`, los perfiles de
mapping y los transformers.

---

## 1. Fuentes de datos

Directorio `plantillas/` (6 archivos, 2 formatos de exportación):

| Archivo | Formato | Modelo detectado | Export |
|---|---|---|---|
| `device-model-ZNID2424A1.csv` | CSV estándar RFC 4180 | ZNID-GPON-2424A1-00 | Aug 8 |
| `device-model-ZNID2424.csv` | CSV estándar RFC 4180 | ZNID-GPON-2424 | Aug 8 |
| `device-model-ZNID2426A1.csv` | CSV estándar RFC 4180 | ZNID-GPON-2426A1-00 | Aug 8 |
| `device-model-ZNID2426A.csv` | CSV estándar RFC 4180 | ZNID-GPON-2426A-NA | Aug 8 |
| `tr-tree-2426a1.csv` | Legacy (filas envueltas en comillas) | ZNID-GPON-2426A1-00 | Jul 8 |
| `tr-tree-hs8145x6.csv` | Legacy (filas envueltas en comillas) | HS8145X6 | Jul 8 |

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

| Feature | 2424A1 | 2424 | 2426A1 | 2426A | HS8145X6 |
|---|---|---|---|---|---|
| WiFi 2.4G (`WLANConfiguration.1`) | — | — | sí (radio off) | sí (radio off) | sí |
| WiFi 5G (`WLANConfiguration.5`) | — | — | — | — | sí |
| GPON `*_String` (rx/tx/temp) | sí | **—** | sí | sí | — (otra ruta) |
| GPON crudo (`RxLevel`/`TxLevel`) | sí | sí | sí | sí | `X_GponInterafceConfig.*` (vacío) |
| `diagnostics.cpu_util` | sí | **—** | sí | sí | — |
| `X_BROADCOM_COM_XPON` (XPON/XGS-PON) | sí | — | sí | — | — |
| Diagnósticos transferencia (DL/UL) | sí | **—** | sí | sí | sí |
| Dot1x (`X_ZHONE_Dot1xPaeSystemObject`) | esqueleto | **completo (314)** | esqueleto | esqueleto | — |
| QueueManagement (colas QoS) | 23 | 19 | **471** | **470** | 32 |
| Bridge PPPoE activo (`LANDevice.N`) | 9 | 13 | 12 | 9 | — (WANIP/PPPoE clásico) |

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
- **Seguridad:** las planillas contienen credenciales en claro (PPPoE `Password`,
  `ConnectionRequestPassword`, y una clave privada RSA en `CertificateCfg.1.PrivKey`).
  El parser las **enmascara** en los volcados (`[REDACTED]`); `plantillas/` no se
  commitea. No subir estos archivos a git.

## 8. Conclusión para F3/F4

Los 4 modelos ZNID comparten plataforma Zhone/Broadcom TR-098 y rutas de catálogo
casi idénticas. **Se recomienda un solo perfil de mapping `ZHONE_TR098` con
feature-detect** (presencia de `WLANConfiguration.1`, `RxLevelString`,
`Cpu0_Util`, e índice del bridge PPPoE por `ConnectionStatus`), en lugar de 4
perfiles. La alternativa "2 perfiles (con/sin WiFi)" no elimina las condiciones:
2424 es el único sin WiFi, pero también le faltan `gpon.rx_power` (sin `*_String`)
y `diagnostics.cpu_util`, que habría que condicionar igual dentro de su perfil.
El feature-detect es necesario en cualquier esquema.

Esto no modifica `DISENO_ABSTRACCION_ONT.md` (pendiente de revisión del equipo);
si la revisión cambia decisiones, se ajusta este inventario y el perfil en F4.
