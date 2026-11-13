'use strict';
/**
 * Texto do Contrato de Adesão à Plataforma Nuk_POS da GESTNUK AI (decisão do dono de 13/11/2026).
 * Funções puras: compõem o texto e as impressões digitais; quem grava e assina é adesao.service.js.
 *
 * As condições gerais são as mesmas da proposta «GESTNUK AI — Contrato de Adesão às Plataformas»
 * (iguais às do EasyCrédito.ao); o Anexo II-B traz as regras do Nuk_POS. Base: Lei n.º 4/03 (cláusulas
 * gerais), Decreto Legislativo Presidencial n.º 14/26 (assinatura electrónica com convenção de prova),
 * Lei n.º 22/11 (dados), foro no Tribunal da Comarca de Luanda (Lei n.º 29/22). Minuta sujeita a revisão
 * jurídica. Mudar o texto = nova ADESAO_VERSAO (os estabelecimentos voltam a assinar); nunca editar uma
 * versão já assinada.
 */
const crypto = require('crypto');

const ADESAO_VERSAO = 'v1 — 13/11/2026';
const TITULAR = 'GESTNUK AI';
const PLATAFORMA = 'Nuk_POS';

const CONDICOES_GERAIS = [
  'Cláusula 1.ª — Definições. Para este contrato: «Plataforma» é a aplicação indicada no Anexo I, com as suas actualizações; «Conta» é o espaço do Aderente na Plataforma; «Utilizadores» são as pessoas a quem o Aderente dá acesso; «Dados do Aderente» são os dados que o Aderente e os seus Utilizadores introduzem; «Licença» é o direito de uso emitido na Plataforma, com o prazo e o preço das Condições Particulares (Anexo I).',
  'Cláusula 2.ª — Objecto. A GESTNUK AI concede ao Aderente uma licença de utilização da Plataforma, não exclusiva e intransmissível, prestada como serviço alojado (acesso pela Internet, sem instalação de software próprio), durante o prazo da Licença, e presta os serviços de manutenção, alojamento e suporte aqui previstos.',
  'Cláusula 3.ª — Natureza de adesão e dever de informação. 1. Estas cláusulas gerais foram comunicadas na íntegra ao Aderente antes da aceitação, que pôde pedir esclarecimentos. 2. As Condições Particulares negociadas prevalecem sobre estas cláusulas gerais. 3. A GESTNUK AI guarda o registo do texto apresentado e da aceitação.',
  'Cláusula 4.ª — Titularidade e propriedade intelectual. 1. A Plataforma, o seu código, bases de dados, desenho, documentação e marcas são da GESTNUK AI e estão protegidos pela Lei n.º 15/14, de 31 de Julho (Direitos de Autor e Conexos). 2. O Aderente não pode copiar, modificar, descompilar, revender, sublicenciar ou ceder a Plataforma, salvo o que a lei permita sem autorização. 3. Os Dados do Aderente, o seu nome e o seu logótipo são do Aderente; o Aderente autoriza a GESTNUK AI a mostrá-los na Plataforma e nos documentos que esta gera.',
  'Cláusula 5.ª — Activação, período de teste e licença. 1. A GESTNUK AI pode conceder um período de teste gratuito de 7, 15 ou 30 dias. 2. A Licença definitiva é emitida pela GESTNUK AI e activada pelo administrador do Aderente na Plataforma; a renovação começa no dia seguinte ao fim da Licença em curso. 3. Sem Licença activa, as funções operacionais ficam bloqueadas; a Conta, os Utilizadores, a Licença e o pedido de ajuda continuam acessíveis e os Dados do Aderente são conservados.',
  'Cláusula 6.ª — Preço e pagamento. 1. O preço é o das Condições Particulares: um valor mensal fixo, ou uma percentagem do volume indicado no Anexo II, com mínimo e tecto mensais quando acordados. 2. Aos valores acresce o IVA e os demais impostos à taxa em vigor. 3. A GESTNUK AI factura no início de cada mês o mês anterior; o pagamento faz-se em 10 dias, por transferência para o IBAN indicado na factura. 4. Com mais de 15 dias de atraso, e depois de aviso com 5 dias de antecedência, a GESTNUK AI pode suspender a Licença até ao pagamento; são devidos juros de mora à taxa legal. 5. Os preços em Kwanzas são actualizados uma vez por ano pela taxa de inflação publicada pelo INE, com aviso de 30 dias.',
  'Cláusula 7.ª — Obrigações da GESTNUK AI. A GESTNUK AI obriga-se a: a) manter a Plataforma disponível, com o objectivo de 99% do tempo em cada mês, excluindo manutenções programadas, avisadas com 48 horas; b) corrigir as falhas e disponibilizar actualizações sem custo adicional; c) proteger os Dados do Aderente com medidas técnicas adequadas (acesso por credenciais pessoais, registos de auditoria, cifra dos dados de identificação quando a Plataforma os trate, cópias de segurança); d) prestar suporte pela função «Ajuda» da Plataforma nos dias úteis, das 8h00 às 17h00 (hora de Luanda), respondendo a incidentes que impeçam o trabalho até ao dia útil seguinte.',
  'Cláusula 8.ª — Obrigações do Aderente. O Aderente obriga-se a: a) dar informações verdadeiras e actualizadas; b) manter um administrador activo e guardar as credenciais (palavras-passe) dos seus Utilizadores, que são pessoais; c) usar a Plataforma de forma lícita; d) cumprir a regulação da sua actividade (licenças, reportes, faturação, prevenção do branqueamento de capitais), sendo o único responsável pelas suas decisões de negócio e pela relação com os seus clientes; e) pagar o preço.',
  'Cláusula 9.ª — Dados pessoais. 1. Quanto aos dados dos clientes do Aderente, o Aderente é o responsável pelo tratamento e a GESTNUK AI é subcontratante, nos termos da Lei n.º 22/11, de 17 de Junho. 2. A GESTNUK AI trata esses dados apenas para prestar o serviço e segundo as instruções do Aderente; não os vende nem os cede, salvo aos prestadores de alojamento necessários ou por obrigação legal. 3. O alojamento fora de Angola só se faz com a autorização da Agência de Protecção de Dados quando exigível. 4. A GESTNUK AI comunica ao Aderente qualquer violação de segurança em até 72 horas depois de a conhecer. 5. Cabe ao Aderente informar os seus clientes, obter os consentimentos e fazer as notificações à Agência de Protecção de Dados que lhe caibam.',
  'Cláusula 10.ª — Confidencialidade. Cada parte guarda sigilo sobre a informação da outra a que tenha acesso, durante o contrato e por 5 anos depois, salvo dever legal de a revelar.',
  'Cláusula 11.ª — Responsabilidade. 1. A GESTNUK AI responde pelos danos que cause por incumprimento deste contrato. 2. Fora dos casos de dolo ou culpa grave, a responsabilidade da GESTNUK AI fica limitada ao valor pago pelo Aderente nos 12 meses anteriores ao facto e não abrange lucros cessantes. 3. A GESTNUK AI não responde pelas decisões do Aderente tomadas com apoio da Plataforma (por exemplo, conceder um crédito ou fixar um preço) nem pelo conteúdo dos reportes que o Aderente submeta às autoridades.',
  'Cláusula 12.ª — Força maior. Nenhuma parte responde pelo atraso ou falha causados por factos fora do seu controlo razoável (falhas gerais de energia ou telecomunicações, catástrofes, actos de autoridade), desde que avise a outra parte logo que possível.',
  'Cláusula 13.ª — Assinatura electrónica e convenção de prova. 1. As partes convencionam, para os efeitos do Regime Jurídico da Assinatura Electrónica (Decreto Legislativo Presidencial n.º 14/26, de 29 de Outubro), que este contrato e os documentos aceites na Plataforma podem ser assinados electronicamente, escrevendo o nome completo depois de entrar com as credenciais pessoais. 2. A Plataforma regista a versão do texto, a data e hora, o dispositivo, o endereço de rede e uma impressão digital (SHA-256) do texto e da assinatura, que permite detectar qualquer alteração posterior. 3. As partes aceitam essa assinatura como verdadeira e os registos da Plataforma como meio de prova, sem prejuízo de prova em contrário.',
  'Cláusula 14.ª — Comunicações. As comunicações fazem-se pelos avisos da Plataforma, por correio electrónico ou por WhatsApp, para os contactos registados na Conta. O Aderente mantém os seus contactos actualizados.',
  'Cláusula 15.ª — Alteração das condições gerais. 1. A GESTNUK AI pode alterar estas condições gerais com aviso de 30 dias. 2. A nova versão é apresentada na Plataforma para aceitação; o Aderente que não a aceite pode resolver o contrato sem penalização até à data em que entraria em vigor. 3. As Condições Particulares só se alteram por acordo.',
  'Cláusula 16.ª — Duração e cessação. 1. O contrato vigora enquanto houver Licença em vigor ou renovação acordada. 2. Qualquer parte pode resolvê-lo por incumprimento grave da outra que não seja corrigido em 15 dias depois de aviso escrito. 3. Ao terminar, o Aderente pode exportar os seus dados durante 30 dias; depois, a GESTNUK AI elimina-os, salvo o que a lei obrigue a conservar.',
  'Cláusula 17.ª — Representação e conflitos de interesse. 1. A GESTNUK AI pode agir por representante ou mandatário com poderes bastantes. 2. Quando um sócio ou gerente da GESTNUK AI tenha funções na entidade Aderente, a negociação, a assinatura e a gestão do contrato pela GESTNUK AI ficam a cargo de um representante designado, sem intervenção dessa pessoa, e a relação é declarada à entidade Aderente.',
  'Cláusula 18.ª — Cessão da posição contratual. O Aderente não pode ceder a sua posição sem acordo escrito da GESTNUK AI. A GESTNUK AI pode ceder a sua posição a sociedade que lhe suceda na titularidade da Plataforma, com aviso de 30 dias ao Aderente.',
  'Cláusula 19.ª — Lei aplicável e foro. 1. O contrato rege-se pela lei angolana. 2. As partes procuram resolver qualquer divergência por acordo no prazo de 30 dias. 3. Não havendo acordo, é competente o Tribunal da Comarca de Luanda, com renúncia a qualquer outro.',
  'Cláusula 20.ª — Disposições finais. 1. A invalidade de uma cláusula não afecta as restantes. 2. O contrato é redigido em língua portuguesa. 3. Fazem parte dele o Anexo I (Condições Particulares) e o Anexo II (disposições da Plataforma contratada).',
];

const ANEXO_II_NUKPOS = [
  '1. Módulos contratados. São os activados na licença do estabelecimento (restauração, hospedagem, caixa, compras e outros).',
  '2. Documentos fiscais. Enquanto o Nuk_POS não estiver certificado pela AGT, os talões e facturas dizem «Documento sem validade fiscal»; o Aderente emite os documentos fiscais pelos meios certificados que use. A GESTNUK AI informa o Aderente quando a certificação estiver concluída.',
  '3. Nuk-Coin e cartões de consumo. São saldos pré-pagos dos clientes do Aderente, geridos por ele; a GESTNUK AI só fornece o registo técnico.',
  '4. Equipamento. Tablets, impressoras, leitores e ligação à Internet não estão incluídos, salvo nas Condições Particulares.',
];

const kz = n => `${Math.round(Number(n || 0)).toLocaleString('pt-PT').replace(/\u00a0|\u202f/g, ' ')} Kz`;
const dataPt = d => {
  if (!d) return '';
  const iso = new Date(d).toLocaleDateString('en-CA', { timeZone: 'Africa/Luanda' });
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

/** Texto completo, já com as Condições Particulares do estabelecimento. */
function textoAdesao({ tenant, titular, licenca, versao = ADESAO_VERSAO }) {
  const l = licenca;
  const nif = tenant.nif ? `, NIF ${tenant.nif}` : '';
  const contacto = [titular.email, tenant.telefone].filter(Boolean).join(', ');
  return [
    `CONTRATO DE ADESÃO À PLATAFORMA NUK_POS — CONDIÇÕES GERAIS DA ${TITULAR} (${versao}) — minuta sujeita a revisão jurídica`,
    `Partes: ${TITULAR}, titular das plataformas EasyCrédito.ao, Nuk_POS e ATC46, representada por quem tenha poderes para o acto («GESTNUK AI»); e ${tenant.nome}${nif}, representada pelo seu administrador titular ${titular.nome}${contacto ? ` (${contacto})` : ''} («Aderente»).`,
    'Considerando que a GESTNUK AI presta a Plataforma como serviço alojado na Internet, que o Aderente a pretende usar na sua actividade e que este é um contrato de adesão cujas cláusulas gerais lhe foram comunicadas na íntegra e explicadas antes da aceitação (Lei n.º 4/03, de 18 de Fevereiro), é celebrado o presente contrato.',
    ...CONDICOES_GERAIS,
    `ANEXO I — CONDIÇÕES PARTICULARES. Plataforma: ${PLATAFORMA}. Aderente: ${tenant.nome}${tenant.nif ? ` (NIF ${tenant.nif})` : ''}. Administrador titular: ${titular.nome}. ` +
      (l ? `Licença: plano ${l.plano_nome || '—'}, de ${dataPt(l.inicio)} a ${dataPt(l.fim)}${Number(l.preco_mensal) ? `, ${kz(l.preco_mensal)} por mês, acrescidos do IVA à taxa em vigor` : ''}. ` : 'Licença e preço: conforme a licença emitida na Plataforma. ') +
      'Pagamento: até 10 dias depois da factura, para o IBAN nela indicado. As licenças seguintes emitidas na Plataforma actualizam estas Condições Particulares.',
    'ANEXO II — DISPOSIÇÕES DA PLATAFORMA NUK_POS.', ...ANEXO_II_NUKPOS,
  ];
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hashTexto = paragrafos => sha256(paragrafos.join('\n\n'));
const hashAssinatura = (texto, nome, quando, extra = '') => sha256([texto, nome, quando, extra].join('|'));

module.exports = { ADESAO_VERSAO, TITULAR, PLATAFORMA, CONDICOES_GERAIS, ANEXO_II_NUKPOS, textoAdesao, hashTexto, hashAssinatura };
