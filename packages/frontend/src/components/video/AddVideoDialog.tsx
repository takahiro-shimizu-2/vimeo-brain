import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (vimeoId: string) => Promise<void>;
}

export function AddVideoDialog({ open, onClose, onAdd }: Props) {
  const [vimeoId, setVimeoId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!vimeoId.trim()) return;
    setLoading(true);
    try {
      await onAdd(vimeoId.trim());
      setVimeoId('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Video</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Vimeo Video ID"
          placeholder="123456789"
          value={vimeoId}
          onChange={e => setVimeoId(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={loading || !vimeoId.trim()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
