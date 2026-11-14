// A small JSON Schema (draft 2020-12 subset) validator, enough for the schemas in schema/.
// Supported: type, enum, const, properties, required, additionalProperties, patternProperties,
// propertyNames, items, minItems, maxItems, uniqueItems, minLength, maxLength, pattern, minimum,
// maximum, exclusiveMinimum, minProperties, oneOf, anyOf, allOf, not, $ref to local "#/..." pointers.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#')) throw new Error(`Only local $ref supported: ${ref}`);
  const parts = ref.slice(1).split('/').filter(Boolean).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const p of parts) {
    node = node?.[p];
    if (node === undefined) throw new Error(`Unresolvable $ref ${ref}`);
  }
  return node;
}

export function validate(schema, value, root = schema, at = '$') {
  const errors = [];
  check(schema, value, at);
  return errors;

  function check(s, v, p) {
    if (s === true || s === undefined) return;
    if (s === false) {
      errors.push(`${p}: not allowed`);
      return;
    }
    if (s.$ref) {
      check(resolveRef(root, s.$ref), v, p);
    }
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(v, t))) {
        errors.push(`${p}: expected ${types.join(' or ')}, got ${typeOf(v)}`);
        return;
      }
    }
    if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
      errors.push(`${p}: must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    }
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) {
      errors.push(`${p}: must equal ${JSON.stringify(s.const)}`);
    }
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) errors.push(`${p}: shorter than ${s.minLength}`);
      if (s.maxLength !== undefined && v.length > s.maxLength) errors.push(`${p}: longer than ${s.maxLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${p}: does not match ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) errors.push(`${p}: below minimum ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errors.push(`${p}: above maximum ${s.maximum}`);
      if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) errors.push(`${p}: must be > ${s.exclusiveMinimum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${p}: needs at least ${s.minItems} item(s)`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${p}: at most ${s.maxItems} item(s)`);
      if (s.uniqueItems) {
        const seen = new Set();
        v.forEach((x, i) => {
          const k = JSON.stringify(x);
          if (seen.has(k)) errors.push(`${p}[${i}]: duplicate item`);
          seen.add(k);
        });
      }
      if (s.items) v.forEach((x, i) => check(s.items, x, `${p}[${i}]`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (s.minProperties !== undefined && keys.length < s.minProperties) errors.push(`${p}: needs at least ${s.minProperties} propert(ies)`);
      for (const r of s.required || []) if (!(r in v)) errors.push(`${p}: missing required "${r}"`);
      for (const k of keys) {
        const kp = `${p}.${k}`;
        let matched = false;
        if (s.properties && k in s.properties) {
          matched = true;
          check(s.properties[k], v[k], kp);
        }
        if (s.patternProperties) {
          for (const [pat, sub] of Object.entries(s.patternProperties)) {
            if (new RegExp(pat, 'u').test(k)) {
              matched = true;
              check(sub, v[k], kp);
            }
          }
        }
        if (s.propertyNames) check(s.propertyNames, k, `${p} key "${k}"`);
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) errors.push(`${kp}: unknown property`);
          else check(s.additionalProperties, v[k], kp);
        }
      }
    }
    if (s.allOf) s.allOf.forEach((sub) => check(sub, v, p));
    if (s.anyOf) {
      const ok = s.anyOf.some((sub) => validate(sub, v, root, p).length === 0);
      if (!ok) errors.push(`${p}: does not match any allowed form${s.description ? ` (${s.description})` : ''}`);
    }
    if (s.oneOf) {
      const results = s.oneOf.map((sub) => validate(sub, v, root, p));
      const passing = results.filter((r) => r.length === 0).length;
      if (passing !== 1) {
        if (passing === 0) {
          // Report the closest branch to keep messages useful.
          const best = results.reduce((a, b) => (b.length < a.length ? b : a));
          errors.push(`${p}: does not match any allowed form${s.description ? ` (${s.description})` : ''}`);
          errors.push(...best.map((e) => `  ${e}`));
        } else errors.push(`${p}: matches more than one form`);
      }
    }
    if (s.not && validate(s.not, v, root, p).length === 0) errors.push(`${p}: matches a forbidden form`);
  }
}
