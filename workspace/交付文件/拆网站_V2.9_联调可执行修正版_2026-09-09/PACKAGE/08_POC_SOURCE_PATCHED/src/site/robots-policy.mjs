function stripComment(line) {
  const i = line.indexOf('#');
  return (i >= 0 ? line.slice(0, i) : line).trim();
}

export function parseRobotsTxt(text = '') {
  const groups = [];
  let agents = [];
  let rules = [];
  let seenRule = false;

  function flush() {
    if (agents.length) groups.push({ agents: [...agents], rules: [...rules] });
    agents = [];
    rules = [];
    seenRule = false;
  }

  for (const raw of String(text).split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (seenRule) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if ((field === 'allow' || field === 'disallow') && agents.length) {
      seenRule = true;
      if (value || field === 'allow') rules.push({ type: field, pattern: value });
    }
  }
  flush();
  return { groups };
}

function matchingGroups(parsed, userAgent) {
  const ua = String(userAgent || '*').toLowerCase();
  const matches = [];
  let best = -1;
  for (const group of parsed?.groups ?? []) {
    for (const token of group.agents ?? []) {
      const score = token === '*' ? 0 : (ua.includes(token) ? token.length : -1);
      if (score < 0) continue;
      if (score > best) {
        matches.length = 0;
        best = score;
      }
      if (score === best) matches.push(group);
      break;
    }
  }
  return matches;
}

function escapeRegex(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function ruleRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const regex = '^' + escapeRegex(source).replace(/\*/g, '.*') + (anchored ? '$' : '');
  return new RegExp(regex);
}

function specificity(pattern) {
  return pattern.replace(/\*/g, '').replace(/\$$/, '').length;
}

export function isRobotsAllowed(parsed, rawUrl, userAgent = 'MatboxComponentEngine') {
  const groups = matchingGroups(parsed, userAgent);
  if (!groups.length) return true;
  const url = new URL(rawUrl);
  const target = `${url.pathname}${url.search}`;
  let best = null;
  for (const group of groups) {
    for (const rule of group.rules ?? []) {
      if (!rule.pattern && rule.type === 'disallow') continue;
      if (!ruleRegex(rule.pattern).test(target)) continue;
      const score = specificity(rule.pattern);
      if (!best || score > best.score || (score === best.score && rule.type === 'allow')) {
        best = { score, type: rule.type, pattern: rule.pattern };
      }
    }
  }
  return best ? best.type !== 'disallow' : true;
}
