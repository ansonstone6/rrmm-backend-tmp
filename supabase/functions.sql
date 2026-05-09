-- supabase/functions.sql
-- Stored procedures called from the API

-- Increment photographer stats after a sale
CREATE OR REPLACE FUNCTION increment_photographer_stats(
  p_photographer_id UUID,
  p_sale_price      NUMERIC,
  p_net             NUMERIC
) RETURNS void AS $$
DECLARE
  v_total_sales INTEGER;
  v_total_earned NUMERIC;
BEGIN
  UPDATE photographer_profiles
  SET
    total_earned  = total_earned + p_net,
    total_sales   = total_sales + 1,
    avg_sale_price = (total_earned + p_net) / (total_sales + 1)
  WHERE id = p_photographer_id
  RETURNING total_sales, total_earned INTO v_total_sales, v_total_earned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment buyer stats after a purchase
CREATE OR REPLACE FUNCTION increment_buyer_stats(
  p_buyer_id UUID,
  p_spent    NUMERIC
) RETURNS void AS $$
BEGIN
  UPDATE buyer_profiles
  SET
    total_spent     = total_spent + p_spent,
    total_purchases = total_purchases + 1
  WHERE id = p_buyer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Monthly earnings breakdown for photographer dashboard
CREATE OR REPLACE FUNCTION photographer_monthly_earnings(
  p_photographer_id UUID,
  p_months          INTEGER DEFAULT 6
) RETURNS TABLE(month TEXT, year INTEGER, gross NUMERIC, net NUMERIC, sales BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(t.created_at, 'Mon')          AS month,
    EXTRACT(YEAR FROM t.created_at)::INTEGER AS year,
    SUM(t.sale_price)                      AS gross,
    SUM(t.photographer_payout)             AS net,
    COUNT(*)                               AS sales
  FROM transactions t
  WHERE
    t.photographer_id = p_photographer_id
    AND t.created_at >= NOW() - (p_months || ' months')::INTERVAL
    AND t.payout_status IN ('paid', 'processing', 'pending')
  GROUP BY TO_CHAR(t.created_at, 'Mon'), EXTRACT(YEAR FROM t.created_at),
           DATE_TRUNC('month', t.created_at)
  ORDER BY DATE_TRUNC('month', t.created_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable realtime for auctions and bids tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
