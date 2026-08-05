# MOCA Automations: ACS (Automatic Configuration Server)

**Status:** Active — Development

**Description:** Automatic Configuration Server for managing ONTs and FTTH equipment across multiple vendors (Zhone DZS, Huawei, ZTE). Pilot with Cooperativa de TODD.

**Goals:**
1. Configure and manage ONTs via ACS
2. Monitor ONT health and statistics
3. Escalate to CRM for customer management
4. Make it a product (not just TODD-specific)

**Partner:** Agustin Sanchez

**Tech Stack:**
- ACS core: GenieACS (TR-069), Mongo DB 4.4
- API: Node.js/Express (v1.5.x), SQLite, JWT
- Frontend: HTML/CSS/JS vanilla (SPA ligera)
- Infra: Docker Compose (nginx, backend, genieacs, simulador)
- Target equipment: Zhone DZS, Huawei OLT, ZTE ONT
- Monitoring: Statistics collection, health checks
- Escalation: Link to CAC/CRM

**GitHub:** rodrigomorales77/moca-acs (private)
**Local:** /home/asg/projects/lab/MOCA-ACS_USP

**Timeline:** TODD pilot first, then productize

**Next Steps:**
- ONT provisioning workflow
- Statistics dashboard
- Integration with CAC
