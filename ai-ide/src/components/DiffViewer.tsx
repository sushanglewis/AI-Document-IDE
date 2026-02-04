import React from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { X, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';

interface DiffViewerProps {
  oldStr: string;
  newStr: string;
  taskId: string;
  onClose: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onApply?: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ oldStr, newStr, taskId, onClose, onAccept, onReject }) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background h-12">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">文档差异对比 (Task: {taskId})</h2>
        </div>
        <div className="flex items-center gap-2">
          {onAccept && (
            <Button variant="default" size="sm" onClick={onAccept} className="bg-green-600 hover:bg-green-700 text-white">
              接收更改
            </Button>
          )}
          {onReject && (
            <Button variant="destructive" size="sm" onClick={onReject}>
              拒绝更改
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4 mr-1" />
            关闭
          </Button>
        </div>
      </div>
      <div className="flex-1 relative">
        <DiffEditor
          original={oldStr}
          modified={newStr}
          language="python" // Default to python or plaintext, maybe infer later?
          theme="vs-dark"
          options={{
            renderSideBySide: true,
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
};
