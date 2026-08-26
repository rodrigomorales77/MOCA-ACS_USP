# Requerimientos VM — MOCA ACS para 15.000 ONUs

> **Proyecto:** MOCA-ACS USP / Cooperativa TODD
> **Fecha:** 2026-08-26

## Por que se requiere ampliar

La plataforma actual opera con ~4.000 ONUs al limite de disco y CPU. Para escalar a 15.000 ONUs y sostener el trafico continuo de provisionamiento y monitoreo es necesario ampliar la VM. El dimensionamiento contempla operacion estable mas margen para picos de reconexion masiva.

## Requerimientos

| Recurso | Minimo | Recomendado |
|---------|--------|-------------|
| **vCPU** | 6 | 8 |
| **RAM** | 16 GiB | 24 GiB |
| **Disco** | 100 GiB SSD | 150 GiB SSD (3.000 IOPS) |
| **Red** | 100 Mbps | 200 Mbps |

- **SO:** Ubuntu 22.04 o 24.04 LTS
- **Base de datos:** MongoDB 7.0 LTS
- **Backup:** snapshot diario, retencion 7 dias

> Minimo = operacion estable con 15k. Recomendado = con margen para picos de reconexion simultanea sin degradacion del servicio.
