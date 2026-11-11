// Laya response for a classification v2 request: every question gets its first label (scales: level 3), tags are "no".
export function layaV2(options) {
  const { questions } = JSON.parse(options.body);
  const answers = Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    if (q.type === 'noul') return [key, { noul: 0 }];
    const labels = Object.keys(q.criteria), pick = labels.includes('3') ? '3' : labels[0];
    return [key, { choice: pick, probabilities: Object.fromEntries(labels.map((l) => [l, l === pick ? 1 : 0])) }];
  }));
  return Response.json({ answers, usage: { truncated: false }, routing: { model: 'multilingual' } });
}
