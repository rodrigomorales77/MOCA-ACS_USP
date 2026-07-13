# Feature Requests

Registro de solicitudes de nuevas funcionalidades, mejoras e ideas para MOCA ACS.

**Última actualización:** 2026-04-18

---

## 📌 Estado de Solicitudes

- ⏳ **Pendiente** - Solicitud recibida, en evaluación
- 🔄 **En Análisis** - Se está evaluando factibilidad
- 📋 **Planificada** - Asignada a un sprint
- 🚀 **En Progreso** - Desarrollo activo
- ✅ **Completada** - Feature implementada
- ❌ **Rechazada** - Descartada (ver razón)

---

## Solicitudes Actuales

### #1 - Sistema de Alertas (NOC)
**Estado:** ⏳ Pendiente  
**Prioridad:** 🔴 Alta  
**Solicitado por:** (Cliente/Usuario)  
**Fecha solicitud:** 2026-04-17

**Descripción:**
Necesitamos alertas cuando:
- Un dispositivo se desconecta
- Una acción programada falla
- Hay múltiples fallos en corto tiempo

**Requisitos:**
- Email de notificación
- SMS opcional
- Dashboard de alertas
- Historial de alertas

**Estimación:** 80 horas  
**Notas:** Puede integrar con Procoop

---

### #2 - Exportación de Datos
**Estado:** ⏳ Pendiente  
**Prioridad:** 🟡 Media  
**Solicitado por:** (Cliente/Usuario)  
**Fecha solicitud:** 2026-04-17

**Descripción:**
Poder exportar:
- Listado de dispositivos (CSV, Excel, JSON)
- Acciones pendientes y aplicadas
- Logs de auditoría
- Reportes personalizados

**Requisitos:**
- Formato CSV (mínimo)
- Formato Excel con gráficos
- JSON para APIs
- Filtros antes de exportar

**Estimación:** 40 horas  
**Notas:** Usar librería xlsx para Excel

---

### #3 - Dashboard Personalizable
**Estado:** ⏳ Pendiente  
**Prioridad:** 🟡 Media  
**Solicitado por:** (Cliente/Usuario)  
**Fecha solicitud:** 2026-04-17

**Descripción:**
Dashboard que permite:
- Drag & drop de widgets
- Ocultar/mostrar gráficos
- Guardar configuración por usuario
- Múltiples vistas (operador, gerente, admin)

**Requisitos:**
- Persistencia en BD
- Interfaz intuitiva
- Responsive
- Temas claro/oscuro

**Estimación:** 60 horas  
**Notas:** Usar grid system (CSS Grid)

---

### #4 - API Pública para Clientes
**Estado:** ⏳ Pendiente  
**Prioridad:** 🟡 Media  
**Solicitado por:** (Cliente/Usuario)  
**Fecha solicitud:** 2026-04-17

**Descripción:**
API REST con autenticación para que clientes:
- Consulten estado de dispositivos
- Creen acciones programadas
- Descarguen reportes
- Integren con sus sistemas

**Requisitos:**
- Documentación OpenAPI
- Rate limiting
- Versionado (v1, v2)
- SDK en Node.js

**Estimación:** 100 horas  
**Notas:** Considerar OAuth2 para seguridad

---

### #5 - Multi-tenant
**Estado:** ⏳ Pendiente  
**Prioridad:** 🟢 Baja  
**Solicitado por:** (Cliente/Usuario)  
**Fecha solicitud:** 2026-04-17

**Descripción:**
Soporte para múltiples cooperativas:
- Aislamiento de datos
- Custom branding (logo, colores)
- Administración independiente
- Facturación por uso

**Requisitos:**
- Schema de BD separado o row-level security
- Validación en todas las rutas
- Información de tenant en JWT
- Tests de aislamiento

**Estimación:** 200 horas  
**Notas:** Feature compleja, requiere refactoring

---

## 💡 Ideas Para Evaluar

### Detección de Anomalías
**Descripción:** Usar ML para detectar comportamiento anómalo en dispositivos  
**Casos de uso:** Detectar intentos de ataque, cambios sospechosos  
**Complejidad:** Alta  
**ROI:** A determinar  

---

### Integración con Procoop
**Descripción:** API REST para sincronizar datos con sistema Procoop  
**Casos de uso:** Actualizar lista de clientes, sincronizar cambios  
**Complejidad:** Media  
**ROI:** Alta  
**Dependencias:** Documentación API de Procoop  

---

### Automatización basada en Reglas
**Descripción:** Workflow builder para crear reglas automatizadas  
**Casos de uso:** "Si dispositivo offline > 1h, enviar acción de reinicio"  
**Complejidad:** Alta  
**ROI:** Media  

---

### Real-time Updates (WebSocket)
**Descripción:** Push de actualizaciones en tiempo real  
**Casos de uso:** Dashboard que se actualiza automáticamente  
**Complejidad:** Media  
**ROI:** Media  
**Dependencias:** Socket.io o ws  

---

### CLI para Operaciones Batch
**Descripción:** Herramienta de línea de comandos para operaciones masivas  
**Casos de uso:** Crear 1000 acciones, cambiar parámetro en todos los dispositivos  
**Complejidad:** Baja  
**ROI:** Baja  

---

## Solicitudes Rechazadas

Ninguna por el momento.

---

## Plantilla para Nuevas Solicitudes

```markdown
### #X - Nombre de la Feature
**Estado:** ⏳ Pendiente  
**Prioridad:** 🔴 Alta | 🟡 Media | 🟢 Baja  
**Solicitado por:** (Nombre/Cliente)  
**Fecha solicitud:** YYYY-MM-DD

**Descripción:**
(Describir qué se necesita y por qué)

**Requisitos:**
- Requisito 1
- Requisito 2
- Requisito 3

**Estimación:** X horas  
**Notas:** (Consideraciones, dependencias, etc.)
```

---

## Proceso de Evaluación

1. **Solicitud recibida** → Estado: Pendiente
2. **Análisis** → Estado: En Análisis
3. **Decisión** → Aceptada o Rechazada
4. **Planificación** → Estado: Planificada + Sprint
5. **Desarrollo** → Estado: En Progreso
6. **Completada** → Estado: Completada + Versión

---

## Estadísticas

| Métrica | Valor |
|---------|-------|
| Total solicitudes | 5 |
| Pendientes | 5 |
| En análisis | 0 |
| Planificadas | 0 |
| En progreso | 0 |
| Completadas | 0 |
| Rechazadas | 0 |

---

**Responsable:** Producto  
**Última revisión:** 2026-04-17
