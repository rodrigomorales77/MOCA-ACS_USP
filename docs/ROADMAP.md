# Roadmap - MOCA ACS

Plan de desarrollo y mejoras futuras para el sistema MOCA TR-069 ACS.

**Versión actual:** 1.5.1  
**Última actualización:** 2026-04-18

---

## 🚀 Corto Plazo (Próximas 2-4 semanas)

### Seguridad (CRÍTICO)
- [ ] Implementar validación obligatoria de JWT_SECRET en producción
- [ ] Agregar validación de patrón Device ID
- [ ] Implementar rate limiting en login (express-rate-limit)
- [ ] Validación de formato email en perfiles
- [ ] Whitelist de proyecciones permitidas en GenieACS

### Features
- [ ] Exportación de logs a CSV/JSON
- [ ] Exportación de acciones pendientes
- [x] Búsqueda avanzada en auditoría (v1.5.1)
- [x] Filtros por rango de fechas (v1.5.1 - pagination + search)
- [x] Gestión de Firmwares (v1.5.0-1.5.1)
- [x] Permisos granulares VIEWER (v1.5.1)
- [x] Auditoría mejorada (v1.5.1)

### Bug Fixes
- [x] Error handling mejorado en usuarios.js (v1.5.1)
- [ ] Logging estructurado (Pino) para debugging

---

## 🔧 Mediano Plazo (1-2 meses)

### Performance
- [ ] Optimización de queries en dispositivos (índices)
- [ ] Caché de resultados de estadísticas
- [ ] Compresión de responses HTTP (gzip)
- [ ] Lazy loading en frontend

### Funcionalidades
- [ ] Sistema de alertas (tipo NOC)
  - [ ] Alertas cuando dispositivo se desconecta
  - [ ] Alertas cuando acción falla
  - [ ] Email/SMS de notificaciones
- [ ] Dashboard de métricas en tiempo real
  - [ ] Gráficos de evolución por hora
  - [ ] Trending de fabricantes
  - [ ] Estado de salud del sistema

### API
- [ ] Documentación OpenAPI/Swagger
- [ ] Versioning de API (v1, v2)
- [ ] Rate limiting global

### Mantenimiento
- [ ] Implementar logging estructurado (Pino)
- [ ] Health check extendido (BD + GenieACS)
- [ ] Monitoreo de recursos (CPU, memoria, disco)

---

## 🧠 Largo Plazo (3-6 meses)

### Análisis Avanzado
- [ ] Motor de detección de anomalías (IA/ML)
  - [ ] Predicción de fallos antes de ocurrir
  - [ ] Detección de comportamientos anómalos
  - [ ] Alertas inteligentes

### Escalabilidad
- [ ] Multi-tenant para distintas cooperativas
  - [ ] Aislamiento de datos por tenant
  - [ ] Facturación por uso
  - [ ] Custom branding

### Integraciones
- [ ] Integración con Procoop (API REST)
- [ ] Integración con ERP/CRM existentes
- [ ] Webhooks para eventos

### Frontend
- [ ] Visualización tipo Grafana embebida
- [ ] Real-time updates (WebSocket)
- [ ] PWA con soporte offline
- [ ] Mobile app (React Native)

---

## 💡 Ideas (Sin Fecha Definida)

### Innovación
- [ ] Motor de predicción de tráfico
- [ ] Optimización automática de parámetros
- [ ] Automatización basada en reglas (workflow builder)

### Integración
- [ ] API pública para clientes
- [ ] SDK en Python/Node.js/Go
- [ ] CLI para operaciones batch

### Experiencia
- [ ] Dashboard personalizable (drag & drop)
- [ ] Temas oscuro/claro
- [ ] Soporte para múltiples idiomas (i18n)
- [ ] Internacionalización (múltiples timezones)

### Operacional
- [ ] Replicación de BD para alta disponibilidad
- [ ] Backup automático en cloud (S3)
- [ ] Disaster recovery plan
- [ ] Load balancing para múltiples instancias

---

## 📊 Métricas de Éxito

Para cada feature, definir:
- [ ] Criterios de aceptación
- [ ] Métricas de éxito
- [ ] Tests asociados
- [ ] Documentación

---

## 🤝 Feedback del Cliente

**Solicitado por:** (a completar según feedback)
- [ ] Feature X
- [ ] Feature Y

**En evaluación:**
- [ ] Propuesta A
- [ ] Propuesta B

---

## Notas

- Este roadmap es flexible y puede cambiar según prioridades
- Las features del "Largo Plazo" pueden moverse a "Corto Plazo" si hay demanda urgente
- Las ideas sin fecha se evalúan según ROI y esfuerzo
- Cada feature debe tener un Issue asociado en Git

**Responsable:** Equipo de desarrollo  
**Última revisión:** 2026-04-17
