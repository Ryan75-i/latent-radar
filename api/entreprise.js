// api/entreprise.js · Recherche d'entreprises françaises, lisible et avec logos
// Source : API Recherche d'entreprises (data.gouv.fr), logos via Clearbit Suggest.

const NAF = {
  '01':'Agriculture','02':'Sylviculture','03':'Pêche','05':'Extraction de houille','06':'Hydrocarbures','07':'Minerais','08':'Extraction minière','09':'Services miniers',
  '10':'Agroalimentaire','11':'Boissons','12':'Tabac','13':'Textile','14':'Habillement','15':'Cuir et chaussure','16':'Bois','17':'Papier et carton','18':'Imprimerie',
  '19':'Raffinage','20':'Chimie','21':'Pharmacie','22':'Caoutchouc et plastiques','23':'Verre et matériaux','24':'Métallurgie','25':'Produits métalliques',
  '26':'Électronique','27':'Équipements électriques','28':'Machines et équipements','29':'Automobile','30':'Matériels de transport','31':'Meubles','32':'Industries diverses','33':'Réparation de machines',
  '35':'Énergie','36':'Eau','37':'Assainissement','38':'Gestion des déchets','39':'Dépollution',
  '41':'Construction de bâtiments','42':'Génie civil','43':'Travaux de construction',
  '45':'Commerce automobile','46':'Commerce de gros','47':'Commerce de détail',
  '49':'Transport terrestre','50':'Transport maritime','51':'Transport aérien','52':'Logistique et entreposage','53':'Poste et courrier',
  '55':'Hébergement','56':'Restauration',
  '58':'Édition et logiciels','59':'Audiovisuel','60':'Diffusion et médias','61':'Télécoms','62':'Services informatiques','63':"Services d'information",
  '64':'Finance','65':'Assurance','66':'Services financiers',
  '68':'Immobilier','69':'Juridique et comptabilité','70':'Conseil et sièges sociaux','71':'Ingénierie et études','72':'Recherche et développement','73':'Publicité et études de marché','74':'Activités spécialisées','75':'Vétérinaires',
  '77':'Location','78':'Recrutement et emploi','79':'Agences de voyage','80':'Sécurité','81':'Services aux bâtiments','82':'Services administratifs',
  '84':'Administration publique','85':'Enseignement','86':'Santé','87':'Hébergement médico-social','88':'Action sociale',
  '90':'Arts et spectacles','91':'Culture et patrimoine','92':"Jeux d'argent",'93':'Sport et loisirs','94':'Organisations associatives','95':'Réparation de biens','96':'Services personnels','97':'Services domestiques','99':'Organisations extraterritoriales'
};
const EFF = {'00':'0 salarié','01':'1 ou 2 salariés','02':'3 à 5 salariés','03':'6 à 9 salariés','11':'10 à 19 salariés','12':'20 à 49 salariés','21':'50 à 99 salariés','22':'100 à 199 salariés','31':'200 à 249 salariés','32':'250 à 499 salariés','41':'500 à 999 salariés','42':'1 000 à 1 999 salariés','51':'2 000 à 4 999 salariés','52':'5 000 à 9 999 salariés','53':'10 000 salariés et plus'};
const CAT = {'PME':'PME','ETI':'ETI','GE':'Grande entreprise'};

function nafLabel(code){ if(!code) return null; return NAF[String(code).slice(0,2)]||null; }
function titre(s){
  if(!s) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase())
          .replace(/\b(Sas|Sarl|Sa|Sci|Snc|Eurl|Sasu)\b/g,m=>m.toUpperCase())
          .replace(/\bDe\b/g,'de').replace(/\bDu\b/g,'du').replace(/\bDes\b/g,'des').replace(/\bEt\b/g,'et').replace(/\bLa\b/g,'la').replace(/\bLe\b/g,'le');
}
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');

async function withTimeout(p,ms){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms);
  try{ return await p(c.signal); } finally{ clearTimeout(t); }
}
async function logoFor(name){
  try{
    const j=await withTimeout(async sig=>{
      const r=await fetch('https://autocomplete.clearbit.com/v1/companies/suggest?query='+encodeURIComponent(name),{signal:sig});
      return r.ok?r.json():[];
    },1200);
    if(!Array.isArray(j)||!j.length) return null;
    const target=norm(name);
    const hit=j.find(x=>{const n=norm(x.name);return n&&(target.startsWith(n)||n.startsWith(target.slice(0,Math.max(4,n.length))));})||j[0];
    if(!hit) return null;
    const n=norm(hit.name);
    if(!(target.includes(n.slice(0,4))||n.includes(target.slice(0,4)))) return null;
    return { logo:hit.logo||null, domain:hit.domain||null };
  }catch(e){ return null; }
}
function shortName(nom){
  const stop=/\b(sas|sarl|sa|sci|snc|eurl|sasu|societe|société|groupe|holding|france)\b/gi;
  return (nom||'').replace(stop,'').trim().split(/\s+/).slice(0,3).join(' ')||nom;
}

function mapResult(r){
  const s=r.siege||{};
  return {
    siren:r.siren,
    nom:titre(r.nom_complet||r.nom_raison_sociale||''),
    sigle:r.sigle||null,
    activite:nafLabel(r.activite_principale)||null,
    code_naf:r.activite_principale||null,
    effectif:EFF[r.tranche_effectif_salarie]||null,
    taille:CAT[r.categorie_entreprise]||null,
    ville:s.libelle_commune?titre(s.libelle_commune):null,
    code_postal:s.code_postal||null
  };
}
function mapDetail(r){
  const s=r.siege||{};
  const annee=r.date_creation?new Date(r.date_creation).getFullYear():null;
  const dirigeants=(r.dirigeants||[]).slice(0,4).map(d=>({
    nom:titre(d.denomination||[d.prenoms,d.nom].filter(Boolean).join(' ')),
    qualite:d.qualite?titre(d.qualite):null
  })).filter(d=>d.nom);
  return {
    siren:r.siren,
    nom:titre(r.nom_complet||r.nom_raison_sociale||''),
    activite:nafLabel(r.activite_principale)||null,
    code_naf:r.activite_principale||null,
    effectif:EFF[r.tranche_effectif_salarie]||null,
    taille:CAT[r.categorie_entreprise]||null,
    annee_creation:annee,
    anciennete:annee?new Date().getFullYear()-annee:null,
    ville:s.libelle_commune?titre(s.libelle_commune):null,
    etablissements:r.nombre_etablissements_ouverts||null,
    dirigeants,
    source:'INSEE via data.gouv.fr'
  };
}

export default async function handler(req,res){
  try{
    const {q,siren}=req.query||{};
    if(siren){
      const r=await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(siren)}&page=1&per_page=1`);
      if(!r.ok) return res.status(502).json({error:'Recherche indisponible.'});
      const j=await r.json();
      const hit=(j.results||[])[0];
      if(!hit) return res.status(404).json({error:'Entreprise introuvable.'});
      const ent=mapDetail(hit);
      const lg=await logoFor(shortName(ent.nom));
      if(lg){ ent.logo=lg.logo; ent.site=lg.domain; }
      res.setHeader('Cache-Control','s-maxage=86400, stale-while-revalidate');
      return res.status(200).json({entreprise:ent});
    }
    if(!q||String(q).trim().length<2) return res.status(400).json({error:'Requête trop courte.'});
    const r=await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&page=1&per_page=7`);
    if(!r.ok) return res.status(502).json({error:'Recherche indisponible.'});
    const j=await r.json();
    const results=(j.results||[]).map(mapResult);
    await Promise.all(results.map(async e=>{
      const lg=await logoFor(shortName(e.nom));
      if(lg){ e.logo=lg.logo; e.site=lg.domain; }
    }));
    res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate');
    return res.status(200).json({results});
  }catch(e){ return res.status(500).json({error:'Erreur serveur.'}); }
}
