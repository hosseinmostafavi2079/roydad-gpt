SET ROLE eventos_tenant_owner;

CREATE TABLE coupon_reservations (
  tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  coupon_id uuid NOT NULL,
  discount_amount bigint NOT NULL CHECK (discount_amount > 0),
  status varchar(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REDEEMED','RELEASED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, payment_id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, coupon_id) REFERENCES coupons(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX coupon_reservations_active_idx ON coupon_reservations (tenant_id, coupon_id)
  WHERE status='ACTIVE';

RESET ROLE;
