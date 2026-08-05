#!/usr/bin/env python3
"""
Inventario de árboles TR-069 exportados desde GenieACS.

Parseo del formato de exportación de GenieACS (CSV con fila envuelta en comillas y
valores con comillas escapadas), normalización y volcado a data/inventory/.

Uso:
    parse_tree.py <input.csv> [<input.csv> ...] --out <dir>

Por cada archivo genera:
    <PROFILE>.params.csv   (parameter, object, writable, value_type, value, notification)
    <PROFILE>.params.json  (volcado estructurado completo)

Además genera:
    index.json             (identidad del equipo, perfil detectado, estadísticas)
    analysis.md            (informe por perfil + cobertura del catálogo + comparación)

Los valores sensibles (password, keys, secrets) se enmascaran en el volcado.
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
SENSITIVE_RE = re.compile(r'(password|passphrase|presharedkey|wepkey|secret|credential|token)', re.I)
MASK = '[REDACTED]'


def parse_line(raw: str) -> list[str]:
    """Decodifica una línea del formato de exportación de GenieACS."""
    raw = raw.rstrip('\r\n')
    if raw.startswith('"'):
        idx = raw.rfind('"')
        body = raw[1:idx].replace('""', '"')
    else:
        body = raw
    parsed = list(csv.reader(io.StringIO(body)))
    return parsed[0] if parsed else []


def parse_file(fn: str) -> list[list[str]]:
    """
    Devuelve las filas del archivo. Maneja el caso del parámetro DeviceLog, cuyo
    valor multilínea se reparte en varias líneas físicas (continuación sin comilla
    inicial y sin campo Parameter).
    """
    records: list[list[str]] = []
    current: list[str] | None = None
    with open(fn, newline='', encoding='utf-8-sig') as f:
        for raw in f:
            raw = raw.rstrip('\r\n')
            if not raw.strip():
                continue
            row = parse_line(raw)
            if not row:
                continue
            if PARAM_RE.match(row[0]):
                current = row
                records.append(row)
            elif current is not None and len(current) > 5:
                current[5] += '\n' + ','.join(row)
    return records


def normalize_name(name: str) -> str:
    """Normaliza el nombre del fabricante para el perfil (ZHONE, HUAWEI, ...)."""
    m = name.strip().upper()
    for token in ('DZS', 'ZHONE'):
        if token in m:
            return 'ZHONE'
    if 'HUAWEI' in m:
        return 'HUAWEI'
    return m.replace(' ', '_') or 'UNKNOWN'


def mask_value(param: str, value: str) -> str:
    if value and SENSITIVE_RE.search(param):
        return MASK
    return value


def build_records(rows: list[list[str]]):
    """Convierte filas crudas en dicts normalizados."""
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


def detect_tree(recs) -> str:
    igd = sum(1 for r in recs if r['parameter'].startswith('InternetGatewayDevice'))
    dev = sum(1 for r in recs if r['parameter'].startswith('Device.'))
    if igd >= dev:
        return 'TR098'
    if dev:
        return 'TR181'
    return 'UNKNOWN'


def profile_name(identity: dict, tree: str) -> str:
    return f"{normalize_name(identity['manufacturer'])}_{identity['productclass']}_{tree}"


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


def write_inventory(fn: Path, rows: list[list[str]], outdir: Path):
    recs = build_records(rows)
    identity = {}
    for r in recs:
        key = r['parameter']
        if key.startswith('DeviceID.'):
            identity[key[len('DeviceID.'):].lower()] = r['value']
    tree = detect_tree(recs)
    profile = profile_name(identity, tree)
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

    return profile, identity, tree, stats


def load_recs(outdir: Path, profile: str):
    with open(outdir / f'{profile}.params.json', encoding='utf-8') as f:
        data = json.load(f)
    return data


def fmt_value(r):
    v = r['value']
    if len(v) > 42:
        v = v[:39] + '...'
    return v.replace('\n', '\\n')


def build_analysis(outdir: Path, entries) -> str:
    profiles = [e[0] for e in entries]
    recs_by_profile = {p: {r['parameter']: r for r in load_recs(outdir, p)['params']} for p in profiles}

    lines = []
    lines.append('# Inventario de árboles TR-069\n')
    lines.append('Fuente: exportaciones del árbol de GenieACS por dispositivo.\n')
    lines.append(f'Perfiles: {", ".join(profiles)}\n')
    lines.append('Valores sensibles enmascarados. Este directorio NO se commitea (está en .gitignore).\n')

    # Catálogo canónico v1 -> rutas candidatas por perfil
    # Formato: canónico -> [ (ruta, etiqueta) ... ]
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
        'wan.pppoe.username': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'],
        'wan.pppoe.password': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password'],
        'wan.ip': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.ExternalIPAddress'],
        'wan.nat.enabled': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.NATEnabled'],
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

    for profile in profiles:
        recs = recs_by_profile[profile]
        data = load_recs(outdir, profile)
        lines.append(f'\n---\n\n## Perfil `{profile}`\n')
        ident = data['identity']
        lines.append('| Campo | Valor |')
        lines.append('|---|---|')
        for k in ('ID', 'Manufacturer', 'OUI', 'ProductClass', 'SerialNumber'):
            lines.append(f'| {k} | {ident.get(k, ident.get(k.lower(), ""))} |')
        st = data['stats']
        lines.append(f'\n- Parámetros: **{st["count"]}** (escr: {st["writable"]}, solo lectura: {st["readonly"]})')
        lines.append(f'- Árbol: **{data["tree"]}**')
        lines.append('\nSecciones principales (top 12 por cantidad):\n')
        lines.append('| Sección | Params |')
        lines.append('|---|---|')
        for sec, cnt in list(st['top_sections'].items())[:12]:
            lines.append(f'| {sec} | {cnt} |')

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
                lines.append(f'| `{canon}` | — (no encontrada) | | |')

    # Comparación
    lines.append('\n---\n\n## Comparación entre perfiles\n')
    if len(profiles) == 2:
        a, b = profiles
        sa, sb = set(recs_by_profile[a]), set(recs_by_profile[b])
        common = sorted(sa & sb)
        only_a = sorted(sa - sb)
        only_b = sorted(sb - sa)
        lines.append(f'- Rutas en ambos: **{len(common)}**')
        lines.append(f'- Solo en `{a}`: **{len(only_a)}**')
        lines.append(f'- Solo en `{b}`: **{len(only_b)}**')
        lines.append('\n### Rutas comunes relevantes (top 30)\n')
        for p in common[:30]:
            lines.append(f'- `{p}`')
        lines.append('\n### Solo en el perfil Huawei (muestra, top 25)\n')
        for p in only_b[:25]:
            lines.append(f'- `{p}`')
        lines.append('\n### Solo en el perfil Zhone (muestra, top 25)\n')
        for p in only_a[:25]:
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
    for fn in args.inputs:
        path = Path(fn)
        if not path.exists():
            print(f'[error] archivo no existe: {path}', file=sys.stderr)
            continue
        rows = parse_file(str(path))
        if not rows:
            print(f'[error] sin filas válidas: {path}', file=sys.stderr)
            continue
        profile, identity, tree, stats = write_inventory(path, rows, outdir)
        print(f'[ok] {path.name}: {len(rows)} filas -> perfil {profile} ({tree})')
        entries.append((profile, identity, tree, stats))

    index = {
        'generated_by': 'tools/inventory/parse_tree.py',
        'profiles': [{'profile': p, 'identity': i, 'tree': t, 'stats': s} for p, i, t, s in entries],
    }
    with open(outdir / 'index.json', 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)

    if entries:
        analysis = build_analysis(outdir, entries)
        (outdir / 'analysis.md').write_text(analysis, encoding='utf-8')
        print(f'[ok] análisis -> {outdir / "analysis.md"}')


if __name__ == '__main__':
    main()
