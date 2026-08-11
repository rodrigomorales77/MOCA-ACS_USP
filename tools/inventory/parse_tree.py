#!/usr/bin/env python3
"""
Inventario de árboles TR-069 exportados desde GenieACS.

Soporta dos formatos de exportación:
- Legacy (`tr-tree-*.csv`): filas lógicas envueltas en comillas con escapado "",
  continuaciones multi-línea para DeviceLog repartidas en líneas físicas.
- Estándar (`device-model-*.csv`): CSV RFC 4180 con header y valores multilínea
  manejados de forma nativa por csv.reader.

Uso:
    parse_tree.py <input.csv> [<input.csv> ...] --out <dir>

Por cada archivo genera:
    <PROFILE>.params.csv   (parameter, object, writable, value_type, value, notification)
    <PROFILE>.params.json  (volcado estructurado completo)

Además genera:
    index.json             (identidad del equipo, perfil detectado, estadísticas)
    analysis.md            (informe por perfil + cobertura del catálogo + feature-detect
                            + comparación entre perfiles)

El perfil se nombra por fabricante + DeviceInfo.ModelName + árbol (fallback a
ProductClass cuando no hay ModelName), porque ProductClass no es único entre
modelos (p. ej. ZNID24xxA1 agrupa 2424A1 y 2426A1).

Los valores sensibles (password, keys, secrets, privkey, connection request) se
enmascaran en el volcado.
"""

import argparse
import csv
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

PARAM_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_.]*$')
SENSITIVE_RE = re.compile(
    r'(password|passphrase|presharedkey|wepkey|secret|credential|token|privkey|connectionrequest)',
    re.I,
)
MASK = '[REDACTED]'
HEADER_MARK = 'Parameter'


def parse_line(raw: str) -> list[str]:
    """Decodifica una línea del formato legacy de exportación de GenieACS."""
    raw = raw.rstrip('\r\n')
    if raw.startswith('"'):
        idx = raw.rfind('"')
        body = raw[1:idx].replace('""', '"')
    else:
        body = raw
    parsed = list(csv.reader(io.StringIO(body)))
    return parsed[0] if parsed else []


def detect_format(fn: str) -> str:
    """
    Distingue export estándar del legacy. Ambos comparten el header; el legacy
    envuelve cada fila lógica entre comillas (la primera fila de datos empieza
    con `"DeviceID.ID,...`), el estándar empieza `DeviceID.ID,...`.
    """
    with open(fn, newline='', encoding='utf-8-sig') as f:
        first = f.readline().lstrip('\ufeff').rstrip('\r\n')
        second = f.readline().rstrip('\r\n')
    if first.startswith('"') or second.startswith('"'):
        return 'legacy'
    return 'standard'


def parse_standard(fn: str) -> list[list[str]]:
    """Export estándar: csv.reader maneja las multilíneas de forma nativa."""
    records = []
    with open(fn, newline='', encoding='utf-8-sig') as f:
        for row in csv.reader(f):
            if not row:
                continue
            if row[0] == HEADER_MARK or not PARAM_RE.match(row[0]):
                continue
            if len(row) >= 8:
                records.append(row)
    return records


def parse_legacy(fn: str) -> list[list[str]]:
    """Export legacy: reconstruye continuaciones multi-línea de DeviceLog."""
    records = []
    current = None
    with open(fn, newline='', encoding='utf-8-sig') as f:
        for raw in f:
            raw = raw.rstrip('\r\n')
            if not raw.strip():
                continue
            row = parse_line(raw)
            if not row:
                continue
            if row[0] == HEADER_MARK:
                continue
            if PARAM_RE.match(row[0]) and len(row) >= 8:
                current = row
                records.append(row)
            elif current is not None and len(current) > 5:
                current[5] += '\n' + ','.join(row)
    return records


def parse_file(fn: str) -> list[list[str]]:
    return parse_standard(fn) if detect_format(fn) == 'standard' else parse_legacy(fn)


def normalize_name(name: str) -> str:
    """Normaliza el nombre del fabricante para el perfil (ZHONE, HUAWEI, ...)."""
    m = name.strip().upper()
    for token in ('DZS', 'ZHONE'):
        if token in m:
            return 'ZHONE'
    if 'HUAWEI' in m:
        return 'HUAWEI'
    return m.replace(' ', '_') or 'UNKNOWN'


def slugify(value: str) -> str:
    value = re.sub(r'[^A-Za-z0-9._-]+', '_', value.strip())
    return value or 'UNKNOWN'


def mask_value(param: str, value: str) -> str:
    if value and SENSITIVE_RE.search(param):
        return MASK
    return value


def build_records(rows: list[list[str]]):
    """Convierte filas crudas en dicts normalizados (con valores enmascarados)."""
    recs = []
    for r in rows:
        if len(r) < 8:
            continue
        recs.append({
            'parameter': r[0],
            'object': r[1] == 'true',
            'writable': r[3] == 'true',
            'value': mask_value(r[0], r[5]),
            'value_type': r[6],
            'notification': r[8] if len(r) > 8 else '',
        })
    return recs


def extract_identity(recs) -> dict:
    """Identidad desde DeviceID.* y DeviceInfo.* (ModelName, HW, SW)."""
    identity = {}
    for r in recs:
        p = r['parameter']
        if p.startswith('DeviceID.'):
            identity[p[len('DeviceID.'):].lower()] = r['value']
        elif p.endswith('.DeviceInfo.ModelName'):
            identity['model_name'] = r['value']
        elif p.endswith('.DeviceInfo.HardwareVersion'):
            identity['hardware_version'] = r['value']
        elif p.endswith('.DeviceInfo.SoftwareVersion'):
            identity['software_version'] = r['value']
    return identity


def detect_tree(recs) -> str:
    igd = sum(1 for r in recs if r['parameter'].startswith('InternetGatewayDevice'))
    dev = sum(1 for r in recs if r['parameter'].startswith('Device.'))
    if igd >= dev:
        return 'TR098'
    if dev:
        return 'TR181'
    return 'UNKNOWN'


def compute_profile(recs):
    identity = extract_identity(recs)
    tree = detect_tree(recs)
    return profile_name(identity, tree), identity, tree


def profile_name(identity: dict, tree: str) -> str:
    mfr = normalize_name(identity.get('manufacturer', 'UNKNOWN'))
    model = identity.get('model_name') or identity.get('productclass') or 'UNKNOWN'
    return f'{mfr}_{slugify(model)}_{tree}'


def analyze(recs) -> dict:
    writable = sum(1 for r in recs if r['writable'])
    vtypes = Counter(r['value_type'] for r in recs)
    sections = Counter()
    for r in recs:
        p = r['parameter']
        if p.startswith('InternetGatewayDevice.'):
            sections[p[len('InternetGatewayDevice.'):].split('.')[0]] += 1
        elif p.startswith('Device.'):
            sections['Device'] += 1
    return {
        'count': len(recs),
        'writable': writable,
        'readonly': len(recs) - writable,
        'value_types': dict(vtypes.most_common(12)),
        'top_sections': dict(sections.most_common(20)),
    }


def write_inventory(fn: Path, rows: list[list[str]], profile: str, identity: dict,
                    tree: str, outdir: Path) -> dict:
    recs = build_records(rows)
    stats = analyze(recs)

    with open(outdir / f'{profile}.params.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['parameter', 'object', 'writable', 'value_type', 'value', 'notification'])
        for r in recs:
            w.writerow([r['parameter'], r['object'], r['writable'], r['value_type'],
                        r['value'], r['notification']])

    payload = {
        'profile': profile,
        'source': fn.name,
        'device_id': identity.get('ID', ''),
        'identity': identity,
        'tree': tree,
        'stats': stats,
        'params': recs,
    }
    with open(outdir / f'{profile}.params.json', 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    return stats


def load_recs(outdir: Path, profile: str):
    with open(outdir / f'{profile}.params.json', encoding='utf-8') as f:
        return json.load(f)


def fmt_value(r):
    v = r['value']
    if len(v) > 42:
        v = v[:39] + '...'
    return v.replace('\n', '\\n')


# Rutas canónicas del catálogo v1 (docs/DISENO_ABSTRACCION_ONT.md) -> rutas candidatas.
CATALOG = {
    'device.serial': ['InternetGatewayDevice.DeviceInfo.SerialNumber'],
    'device.manufacturer': ['InternetGatewayDevice.DeviceInfo.Manufacturer'],
    'device.model': ['InternetGatewayDevice.DeviceInfo.ModelName'],
    'device.hardware_version': ['InternetGatewayDevice.DeviceInfo.HardwareVersion'],
    'device.software_version': ['InternetGatewayDevice.DeviceInfo.SoftwareVersion'],
    'device.uptime': ['InternetGatewayDevice.DeviceInfo.UpTime'],
    'device.provisioning_code': ['InternetGatewayDevice.DeviceInfo.ProvisioningCode'],
    'wifi.radio.2g.enabled': ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable'],
    'wifi.radio.2g.ssid': ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'],
    'wifi.radio.2g.password': [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase'],
    'wifi.radio.2g.channel': ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel'],
    'wifi.radio.2g.security': [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BasicAuthenticationMode',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BasicEncryptionModes',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.IEEE11iAuthenticationMode',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.IEEE11iEncryptionModes'],
    'wifi.radio.5g.enabled': ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable'],
    'wifi.radio.5g.ssid': ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID'],
    'lan.ip': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress'],
    'lan.netmask': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceSubnetMask'],
    'lan.dhcp.enabled': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DHCPServerEnable'],
    'lan.dhcp.pool_start': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MinAddress'],
    'lan.dhcp.pool_end': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MaxAddress'],
    'lan.dhcp.lease_time': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DHCPLeaseTime'],
    'lan.dhcp.dns.primary': ['InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers'],
    'wan.mode': [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.ConnectionType',
        'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.X_ZHONE_COM_ConnectionType'],
    'wan.ip': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.ExternalIPAddress'],
    'wan.nat.enabled': [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.NATEnabled',
        'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.X_ZHONE_COM_NATenabled'],
    'gpon.rx_power': [
        'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower',
        'InternetGatewayDevice.X_ZHONE_COM_GPON.RxLevelString'],
    'gpon.tx_power': [
        'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower',
        'InternetGatewayDevice.X_ZHONE_COM_GPON.TxLevelString'],
    'gpon.status': [
        'InternetGatewayDevice.X_ZHONE_COM_GPON.GponOperStatus',
        'InternetGatewayDevice.X_HW_PonQualityMonitor.Enable'],
    'diagnostics.temperature': [
        'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TransceiverTemperature',
        'InternetGatewayDevice.X_ZHONE_COM_GPON.TemperatureString'],
}

# Canónicos cuya ruta varía por índice de instancia (p. ej. el bridge PPPoE de Zhone
# vive en LANDevice.N distinto según modelo). Se resuelven por regex sobre las rutas.
DYNAMIC_CATALOG = {
    'wan.pppoe.username': re.compile(r'X_ZHONE_COM_PPPoEConfig\.Username$'),
    'wan.pppoe.password': re.compile(r'X_ZHONE_COM_PPPoEConfig\.Password$'),
    'wan.mode': re.compile(r'IPInterface\.\d+\.X_ZHONE_COM_ConnectionType$'),
    'gpon.status': re.compile(r'X_ZHONE_COM_GPON\.GponOperStatus$'),
    'diagnostics.temperature': re.compile(r'X_ZHONE_COM_GPON\.TemperatureString$'),
}

# Feature-detect por perfil (presencia de subárboles / parámetros).
FEATURES = [
    ('wifi.radio.2g', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.'),
    ('wifi.radio.5g', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.'),
    ('gpon.optical_string', 'InternetGatewayDevice.X_ZHONE_COM_GPON.RxLevelString'),
    ('gpon.optical_raw', 'InternetGatewayDevice.X_ZHONE_COM_GPON.RxLevel'),
    ('diag.cpu_util', 'InternetGatewayDevice.X_ZHONE_System.X_ZHONE_COM_Cpu0_Util'),
    ('xpon_support', 'InternetGatewayDevice.X_BROADCOM_COM_XPON.'),
    ('diag.transfer', 'InternetGatewayDevice.DownloadDiagnostics.'),
    ('dot1x', 'InternetGatewayDevice.X_ZHONE_Dot1xPaeSystemObject.'),
    ('voice_service', 'InternetGatewayDevice.Services.VoiceService.'),
    ('manageable_device', 'InternetGatewayDevice.ManageableDevice.'),
]

PPPOE_RE = re.compile(
    r'InternetGatewayDevice\.LANDevice\.(\d+)\.LANHostConfigManagement\.'
    r'IPInterface\.\d+\.X_ZHONE_COM_PPPoEConfig\.Username'
)
PPPOE_STATUS_RE = re.compile(
    r'InternetGatewayDevice\.LANDevice\.(\d+)\.LANHostConfigManagement\.'
    r'IPInterface\.\d+\.X_ZHONE_COM_PPPoEStatus\.ConnectionStatus'
)


def pppoe_active_interfaces(recs) -> list[int]:
    """Índice LANDevice del bridge PPPoE activo (ConnectionStatus=Connected).

    Los equipos Zhone en planta corren todo en bridge y exponen la config PPPoE
    en cada interfaz; el índice varía por modelo, así que se resuelve por estado.
    """
    connected = sorted(
        int(m.group(1))
        for p in recs
        if (m := PPPOE_STATUS_RE.match(p)) and recs[p]['value'] == 'Connected'
    )
    if connected:
        return connected
    return sorted({int(m.group(1)) for p in recs if PPPOE_RE.match(p)})


def has_prefix(keys, prefix) -> bool:
    return any(k.startswith(prefix) for k in keys)


def build_analysis(outdir: Path, entries) -> str:
    profiles = [e[0] for e in entries]
    recs_by_profile = {
        p: {r['parameter']: r for r in load_recs(outdir, p)['params']} for p in profiles
    }

    lines = []
    lines.append('# Inventario de árboles TR-069\n')
    lines.append('Fuente: exportaciones del árbol de GenieACS por dispositivo.\n')
    lines.append(f'Perfiles: {", ".join(profiles)}\n')
    lines.append('Valores sensibles enmascarados. Este directorio NO se commitea (está en .gitignore).\n')

    for profile in profiles:
        recs = recs_by_profile[profile]
        data = load_recs(outdir, profile)
        ident = data['identity']
        lines.append(f'\n---\n\n## Perfil `{profile}`\n')
        lines.append('| Campo | Valor |')
        lines.append('|---|---|')
        ident_rows = [
            ('ID', 'id'), ('Manufacturer', 'manufacturer'), ('OUI', 'oui'),
            ('ProductClass', 'productclass'), ('SerialNumber', 'serialnumber'),
            ('ModelName', 'model_name'), ('HardwareVersion', 'hardware_version'),
            ('SoftwareVersion', 'software_version'),
        ]
        for label, key in ident_rows:
            lines.append(f'| {label} | {ident.get(key, "")} |')
        st = data['stats']
        lines.append(f'\n- Parámetros: **{st["count"]}** (escr: {st["writable"]}, solo lectura: {st["readonly"]})')
        lines.append(f'- Árbol: **{data["tree"]}**')
        lines.append('\nSecciones principales (top 12 por cantidad):\n')
        lines.append('| Sección | Params |')
        lines.append('|---|---|')
        for sec, cnt in list(st['top_sections'].items())[:12]:
            lines.append(f'| {sec} | {cnt} |')

        lines.append('\n### Feature-detect\n')
        pppoe = pppoe_active_interfaces(recs)
        lines.append(
            f'- Bridge PPPoE activo en `LANDevice.{",".join(map(str, pppoe)) or "—"}`\n'
        )
        lines.append('| Feature | Presencia |')
        lines.append('|---|---|')
        for name, prefix in FEATURES:
            present = has_prefix(recs, prefix)
            lines.append(f'| {name} | {"sí" if present else "—"} |')

        lines.append('\n### Cobertura del catálogo v1 (rutas candidatas)\n')
        lines.append('| Canónico | Ruta | W | Valor |')
        lines.append('|---|---|---|---|')
        for canon, paths in CATALOG.items():
            found = False
            for p in paths:
                r = recs.get(p)
                if r is None:
                    continue
                found = True
                lines.append(f'| `{canon}` | `{p}` | {"sí" if r["writable"] else "no"} | `{fmt_value(r)}` |')
            if not found:
                dyn = DYNAMIC_CATALOG.get(canon)
                for p in recs:
                    if dyn and dyn.search(p):
                        r = recs[p]
                        found = True
                        lines.append(
                            f'| `{canon}` | `{p}` | {"sí" if r["writable"] else "no"} | `{fmt_value(r)}` |')
            if not found:
                lines.append(f'| `{canon}` | — (no encontrada) | | |')

    # Comparación entre perfiles (N)
    lines.append('\n---\n\n## Comparación entre perfiles\n')
    sets = {p: set(recs_by_profile[p]) for p in profiles}
    union = set().union(*sets.values())
    common = set.intersection(*sets.values())
    lines.append(f'- Rutas en TODOS los perfiles: **{len(common)}**')
    lines.append(f'- Rutas en al menos uno (unión): **{len(union)}**\n')

    lines.append('| Perfil | Params | Writable | % unión | Exclusivas |')
    lines.append('|---|---|---|---|---|')
    for p in profiles:
        others = set().union(*(sets[q] for q in profiles if q != p))
        excl = sets[p] - others
        st = load_recs(outdir, p)['stats']
        lines.append(f'| {p} | {st["count"]} | {st["writable"]} | '
                     f'{100 * len(sets[p]) // len(union)}% | {len(excl)} |')

    lines.append('\n### Rutas exclusivas por perfil (muestra, top 10)\n')
    for p in profiles:
        others = set().union(*(sets[q] for q in profiles if q != p))
        excl = sorted(sets[p] - others)
        lines.append(f'**{p}** — {len(excl)} exclusivas:\n')
        for path in excl[:10]:
            lines.append(f'- `{path}`')
        lines.append('')

    lines.append('### Rutas comunes a todos los perfiles (muestra, top 25)\n')
    for p in sorted(common)[:25]:
        lines.append(f'- `{p}`')

    return '\n'.join(lines) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('inputs', nargs='+', help='CSV exportados de GenieACS')
    ap.add_argument('--out', default='data/inventory', help='Directorio de salida')
    args = ap.parse_args(argv)

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    entries = []
    used = set()
    for fn in args.inputs:
        path = Path(fn)
        if not path.exists():
            print(f'[error] archivo no existe: {path}', file=sys.stderr)
            continue
        rows = parse_file(str(path))
        if not rows:
            print(f'[error] sin filas válidas: {path}', file=sys.stderr)
            continue
        recs = build_records(rows)
        profile, identity, tree = compute_profile(recs)
        if profile in used:
            profile = f'{profile}.{path.stem}'
        used.add(profile)
        stats = write_inventory(path, rows, profile, identity, tree, outdir)
        print(f'[ok] {path.name}: {len(recs)} params -> perfil {profile} ({tree})')
        entries.append((profile, identity, tree, stats, path.name))

    index = {
        'generated_by': 'tools/inventory/parse_tree.py',
        'profiles': [
            {'profile': p, 'source': s, 'identity': i, 'tree': t, 'stats': st}
            for p, i, t, st, s in entries
        ],
    }
    with open(outdir / 'index.json', 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)

    if entries:
        analysis = build_analysis(outdir, entries)
        (outdir / 'analysis.md').write_text(analysis, encoding='utf-8')
        print(f'[ok] análisis -> {outdir / "analysis.md"}')


if __name__ == '__main__':
    main()
