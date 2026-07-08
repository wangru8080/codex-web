'use client';

import { useState, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SaveButton } from '@/components/ui/save-button';

interface ConfigEditorProps {
  value: string;
  onSave: (value: string) => void;
  label?: string;
  /** Set to true by the parent while the save request is in flight. */
  saving?: boolean;
}

export function ConfigEditor({ value, onSave, label, saving = false }: ConfigEditorProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setText(value); }, [value]);

  function handleSave() {
    try {
      JSON.parse(text);
      setError(null);
      onSave(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  function handleFormat() {
    try {
      const parsed = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  // Dirty when the user has typed but not yet saved. Invalid JSON
  // (error !== null) keeps the button enabled — clicking re-validates
  // and surfaces the parse error in the inline message.
  const dirty = text !== value;

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        className="font-mono text-sm min-h-[200px]"
        placeholder="{}"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <SaveButton dirty={dirty} saving={saving} onClick={handleSave} />
        <Button size="sm" variant="outline" onClick={handleFormat}>
          Format
        </Button>
      </div>
    </div>
  );
}
