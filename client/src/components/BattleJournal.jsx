import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';
import { Busy, Icon, ICONS, useBusy } from './ui.jsx';

export default function BattleJournal({ battle }) {
  const { t, lang } = useApp();
  const [result, setResult] = useState(null);
  const resultKey = battle.id + ':' + lang;
  const [busy, run] = useBusy();
  useEffect(() => { setResult(null); }, [battle.id, lang]);
  const create = () => run('journal', async () => {
    const report = await api.call('battle_journal', { id: battle.id, lang });
    setResult({ ...report, key: resultKey });
  });
  return <div className="flex flex-wrap items-center gap-2">
    <Busy busy={busy.journal} className="btn" onClick={create}><Icon d={ICONS.download} size={15}/>{t('bj_create')}</Busy>
    {result?.key === resultKey && <><a className="btn" href={api.exportUrl(result.file) + '?download=false'} target="_blank" rel="noopener noreferrer">{t('bj_open')}</a>
      <a className="btn btn-sm" href={api.exportUrl(result.file)} download={result.file}>{t('bj_download')}</a></>}
  </div>;
}
