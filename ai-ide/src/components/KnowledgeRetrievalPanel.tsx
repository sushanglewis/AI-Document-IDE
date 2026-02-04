import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { apiClient } from '../lib/api';

interface KnowledgeBase {
  id: number;
  name: string;
  dataset_id: string;
  api_key: string;
  api_url: string;
  retrieval_model?: any;
}

interface KnowledgeRetrievalPanelProps {
  kb: KnowledgeBase;
  onClose: () => void;
}

export const KnowledgeRetrievalPanel: React.FC<KnowledgeRetrievalPanelProps> = ({ kb, onClose }) => {
  const [retrieveQuery, setRetrieveQuery] = useState('');
  const [retrieveResult, setRetrieveResult] = useState('');
  const [isRetrieving, setIsRetrieving] = useState(false);

  const handleRetrieveTest = async () => {
    if (!kb || !retrieveQuery.trim()) return;
    setIsRetrieving(true);
    setRetrieveResult('');
    try {
      const res = await apiClient.testKnowledgeRetrieval(kb.id, retrieveQuery);
      setRetrieveResult(res.result);
    } catch (e: any) {
      setRetrieveResult(`Error: ${e.response?.data?.detail || e.message}`);
    } finally {
      setIsRetrieving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          召回测试: {kb.name}
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        <div className="flex gap-2 shrink-0">
          <Input 
            value={retrieveQuery} 
            onChange={e => setRetrieveQuery(e.target.value)} 
            placeholder="输入测试问题..." 
            onKeyDown={e => e.key === 'Enter' && handleRetrieveTest()}
          />
          <Button onClick={handleRetrieveTest} disabled={isRetrieving}>
            {isRetrieving ? <Loader2 className="w-4 h-4 animate-spin" /> : '召回'}
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 bg-muted rounded-md text-sm font-mono border">
          <pre className="whitespace-pre-wrap break-all">
            {retrieveResult || <span className="text-muted-foreground">结果将显示在这里...</span>}
          </pre>
        </div>
      </div>
    </div>
  );
};
