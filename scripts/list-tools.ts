/**
 * Imprime le catalogue d'outils (les deux paliers, indépendamment de
 * MA_ALLOW_TIER2) — à coller/adapter dans PALIERS.md après tout ajout
 * d'outil. Ne fait AUCUN appel réseau.
 */
import { tier1ClientTools } from '../src/tools/tier1/clients.js';
import { tier1EcrituresTools } from '../src/tools/tier1/ecritures.js';
import { tier1QuickbooksTools } from '../src/tools/tier1/quickbooks.js';
import { tier1QboGeneriqueTools } from '../src/tools/tier1/qboGenerique.js';
import { tier1QboRapportTools } from '../src/tools/tier1/qboRapport.js';
import { tier1RevenusSansTaxeTools } from '../src/tools/tier1/revenusSansTaxe.js';
import { tier1AdminTools } from '../src/tools/tier1/admin.js';
import { tier1ConciliationTools } from '../src/tools/tier1/conciliation.js';
import { tier2QboTools } from '../src/tools/tier2/qboAnalyse.js';
import { tier2FacturationTools } from '../src/tools/tier2/facturation.js';
import { tier2RelanceTools } from '../src/tools/tier2/relance.js';
import { tier2ConciliationTools } from '../src/tools/tier2/conciliation.js';
import { tier2CorrectifsTools } from '../src/tools/tier2/correctifs.js';
import { tier2EcritureManuelleTools } from '../src/tools/tier2/ecritureManuelle.js';
import { tier2QboTaxeTransactionTools } from '../src/tools/tier2/qboTaxeTransaction.js';
import { tier2QboTaxeLotTools } from '../src/tools/tier2/qboTaxeLot.js';
import { tier2QboTaxeLotInverserTools } from '../src/tools/tier2/qboTaxeLotInverser.js';
import { tier2QboTaxeSensTools } from '../src/tools/tier2/qboTaxeSens.js';
import { tier2QboEcrireTools } from '../src/tools/tier2/qboEcrire.js';
import { tier2ReleveDeposerTools } from '../src/tools/tier2/releveDeposer.js';
import { tier2EcrituresLotTools } from '../src/tools/tier2/ecrituresLot.js';

const all = [
  ...tier1ClientTools,
  ...tier1EcrituresTools,
  ...tier1QuickbooksTools,
  ...tier1QboGeneriqueTools,
  ...tier1QboRapportTools,
  ...tier1RevenusSansTaxeTools,
  ...tier1AdminTools,
  ...tier1ConciliationTools,
  ...tier2QboTools,
  ...tier2FacturationTools,
  ...tier2RelanceTools,
  ...tier2ConciliationTools,
  ...tier2CorrectifsTools,
  ...tier2EcritureManuelleTools,
  ...tier2QboTaxeTransactionTools,
  ...tier2QboTaxeLotTools,
  ...tier2QboTaxeLotInverserTools,
  ...tier2QboTaxeSensTools,
  ...tier2QboEcrireTools,
  ...tier2ReleveDeposerTools,
  ...tier2EcrituresLotTools,
];

for (const t of all) {
  console.log(`\n### ${t.name}  [palier ${t.tier}${t.requiresAdmin ? ', requireAdmin' : ''}]`);
  console.log(`action sous-jacente : ${t.action}`);
  console.log(t.description);
}

console.log(`\n--- Total : ${all.length} outils (${all.filter((t) => t.tier === 1).length} palier 1, ${all.filter((t) => t.tier === 2).length} palier 2)`);
