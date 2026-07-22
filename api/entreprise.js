// api/entreprise.js · Recherche d'entreprises (data.gouv.fr)
// Gratuit, public, aucune clé requise. Limite : 7 appels/seconde.
// GET /api/entreprise?q=novaflux        -> liste de suggestions
// GET /api/entreprise?siren=123456789   -> fiche complète d'une entreprise

const BASE = 'https://recherche-entreprises.api.gouv.fr/search';

// Tranches d'effectif INSEE -> libellé lisible
const EFFECTIF = {
  '00':'0 salarié','01':'1 à 2 salariés','02':'3 à 5 salariés','03':'6 à 9 salariés',
  '11':'10 à 19 salariés','12':'20 à 49 salariés','21':'50 à 99 salariés','22':'100 à 199 salariés',
  '31':'200 à 249 salariés','32':'250 à 499 salariés','41':'500 à 999 salariés','42':'1000 à 1999 salariés',
  '51':'2000 à 4999 salariés','52':'5000 à 9999 salariés','53':'10 000 salariés et plus'
};

// Ordre de grandeur exploitable par le brief (pour calibrer le discours)
function taille(tranche, effectifs) {
  if (typeof effectifs === 'number' && effectifs > 0) {
    if (effectifs < 10) return 'TPE';
    if (effectifs < 50) return 'PME';
    if (effectifs < 250) return 'PME / ETI';
    if (effectifs < 5000) return 'ETI';
    return 'Grand groupe';
  }
  const n = parseInt(tranche, 10);
  if (isNaN(n)) return null;
  if (n <= 3) return 'TPE';
  if (n <= 12) return 'PME';
  if (n <= 22) return 'PME / ETI';
  if (n <= 42) return 'ETI';
  return 'Grand groupe';
}

function nom(e) {
  return e.nom_complet || e.nom_raison_sociale || (e.siege && e.siege.denomination) || 'Entreprise';
}

function ville(e) {
  const s = e.siege || {};
  const cp = s.code_postal || '';
  const v = s.libelle_commune || '';
  return [v, cp].filter(Boolean).join(' ').trim() || null;
}

// Version courte pour la liste d'autocomplétion
function light(e) {
  return {
    siren: e.siren,
    nom: nom(e),
    ville: ville(e),
    activite: e.activite_principale ? (e.libelle_activite_principale || e.activite_principale) : null,
    effectif: EFFECTIF[e.tranche_effectif_salarie] || null,
    active: (e.etat_administratif || (e.siege && e.siege.etat_administratif)) !== 'C'
  };
}

// Version complète, celle qui nourrit le brief
function full(e) {
  const s = e.siege || {};
  const dirigeants = (e.dirigeants || [])
    .filter(d => d.nom || d.denomination)
    .slice(0, 3)
    .map(d => ({
      nom: d.denomination || [d.prenoms, d.nom].filter(Boolean).join(' ').trim(),
      qualite: d.qualite || null
    }));

  const annee = e.date_creation ? String(e.date_creation).slice(0, 4) : null;

  return {
    siren: e.siren,
    nom: nom(e),
    forme_juridique: e.nature_juridique || null,
    activite: e.libelle_activite_principale || null,
    code_naf: e.activite_principale || null,
    section: e.section_activite_principale || null,
    effectif: EFFECTIF[e.tranche_effectif_salarie] || null,
    effectif_num: typeof e.nombre_etablissements_ouverts === 'number' ? null : null,
    taille: taille(e.tranche_effectif_salarie, null),
    annee_creation: annee,
    anciennete: annee ? (new Date().getFullYear() - parseInt(annee, 10)) : null,
    ville: ville(e),
    adresse: s.adresse || null,
    departement: s.departement || null,
    region: s.region || null,
    etablissements: e.nombre_etablissements_ouverts || null,
    dirigeants,
    active: (e.etat_administratif || s.etat_administratif) !== 'C',
    source: 'Recherche d entreprises · data.gouv.fr (INSEE)'
  };
}

export default async function handler(req, res) {
  try {
    const q = (req.query.q || '').toString().trim();
    const siren = (req.query.siren || '').toString().trim();

    if (!q && !siren) return res.status(400).json({ error: 'Paramètre q ou siren requis.' });

    // Recherche par SIREN : fiche complète
    if (siren) {
      if (!/^\d{9}$/.test(siren)) return res.status(400).json({ error: 'SIREN invalide.' });
      const r = await fetch(`${BASE}?q=${siren}&page=1&per_page=1`, { headers: { accept: 'application/json' } });
      if (!r.ok) return res.status(502).json({ error: 'Service indisponible.' });
      const data = await r.json();
      const e = (data.results || [])[0];
      if (!e) return res.status(404).json({ error: 'Entreprise introuvable.' });
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      return res.status(200).json({ entreprise: full(e) });
    }

    // Autocomplétion : liste courte
    if (q.length < 3) return res.status(200).json({ results: [] });
    const r = await fetch(`${BASE}?q=${encodeURIComponent(q)}&page=1&per_page=8`, { headers: { accept: 'application/json' } });
    if (!r.ok) return res.status(502).json({ error: 'Service indisponible.' });
    const data = await r.json();
    const results = (data.results || []).map(light).filter(x => x.active);
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}
