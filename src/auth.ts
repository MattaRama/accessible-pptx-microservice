import { type Request, type Response, type NextFunction } from 'express';
import { supabase } from './supabase';
import { type Tables } from '../supabase/database.types';

type AuthRow = Tables<'auth'>;

/**
 * Validates an API key against the Supabase `auth` table.
 * Returns the matching row if found, or `null` if the key does not exist.
 */
async function checkApiKey(key: string): Promise<AuthRow | null> {
  const { data, error } = await supabase
    .from('auth')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    throw new Error(`Auth lookup failed: ${error.message}`);
  }

  return data;
}

export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Fetch the API key from standard headers
  const apiKey = req.header('authorization');
  
  if (!apiKey) {
    res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'API key is missing.' 
    });
    return;
  }

  const apiKeySplit = apiKey.split(' ');

  if (apiKeySplit.length !== 2 || apiKeySplit[0] !== 'Bearer') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid Bearer token format.'
    });
    return;
  }

  let authRow;
  try {
    authRow = await checkApiKey(apiKeySplit[1]!);
  } catch (error) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Unable to lookup API key.'
    });
    return;
  }


  if (!authRow) {
    res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Invalid API key.' 
    });
    return; 
  }

  if (!authRow.perm_docx) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'DOCX not permitted.'
    });
  }

  next();
};