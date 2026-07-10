// Configuration front (éditable par déploiement, non minifiée).
// api : base de l'API de collaboration.
//   - Déploiement « app unique » (Node sert le front + /api) : garder '/api'.
//   - Front statique séparé + API distincte : mettre l'URL complète,
//     ex. 'https://mon-api.cleverapps.io/api'.
//   - Laisser tel quel désactive proprement l'édition si l'API est absente.
window.HOLOCRON = { api: '/api' };
