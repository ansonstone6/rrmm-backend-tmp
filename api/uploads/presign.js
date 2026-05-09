/**
 * POST /api/uploads/presign
 * Returns a signed URL for direct-to-Supabase-Storage upload
 * Photographer uploads content directly from mobile — no server in the middle
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_PHOTO_MB = 50;
const MAX_VIDEO_MB = 500;
const ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','image/tiff','video/mp4','video/quicktime','video/mov'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'photographer') return res.status(403).json({ error: 'Photographers only' });

  const { fileType, fileSizeMb, contentType } = req.body;

  if (!ALLOWED_TYPES.includes(fileType)) {
    return res.status(400).json({ error: `File type ${fileType} not allowed` });
  }

  const isVideo = fileType.startsWith('video/');
  const maxMb = isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB;
  if (fileSizeMb > maxMb) {
    return res.status(400).json({ error: `File too large. Max ${maxMb}MB for ${isVideo ? 'video' : 'photos'}` });
  }

  const ext = fileType.split('/')[1].replace('quicktime', 'mov');
  const fileId = uuidv4();

  // Generate signed upload URLs for all three buckets
  // Preview (compressed) — public
  // Watermarked — public
  // Full-res — private, only released after payment
  const [previewSigned, fullSigned] = await Promise.all([
    supabaseAdmin.storage.from('previews').createSignedUploadUrl(`${user.id}/${fileId}.${ext}`),
    supabaseAdmin.storage.from('fullres').createSignedUploadUrl(`${user.id}/${fileId}.${ext}`),
  ]);

  if (previewSigned.error || fullSigned.error) {
    return res.status(500).json({ error: 'Failed to generate upload URLs' });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return res.status(200).json({
    fileId,
    preview: {
      signedUrl: previewSigned.data.signedUrl,
      token: previewSigned.data.token,
      publicUrl: `${baseUrl}/storage/v1/object/public/previews/${user.id}/${fileId}.${ext}`,
    },
    fullres: {
      signedUrl: fullSigned.data.signedUrl,
      token: fullSigned.data.token,
      // Full URL is never returned to the client directly — retrieved by server on purchase
    },
    instructions: 'Upload preview to preview.signedUrl, full-res to fullres.signedUrl, then POST to /api/auctions with the returned publicUrl as preview_url',
  });
}
