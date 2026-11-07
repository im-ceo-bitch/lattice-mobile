import unittest
from monitor.extract import parse_offer_card,parse_currency
class FareTests(unittest.TestCase):
 def test_c6_valid(self):
  x=parse_offer_card('Tashkent TAS to Jeddah JED C6 401 Optimal 1 250 000 UZS багаж 23 кг',airline_code='C6',provider='centrum',origin='TAS',destination='JED',date='2026-12-15',source_url='https://b2c.centrum-air.com/')
  self.assertEqual(x['amount_minor'],1250000);self.assertEqual(x['flight_number'],'C6401');self.assertEqual(x['baggage_checked_kg'],23)
 def test_flynas_valid(self):
  x=parse_offer_card('Jeddah JED Tashkent TAS XY 633 Economy SAR 1250',airline_code='XY',provider='flynas',origin='JED',destination='TAS',date='2026-12-12',source_url='https://www.flynas.com/')
  self.assertEqual(x['amount_minor'],125000);self.assertEqual(x['currency'],'SAR')
 def test_fail_closed(self):
  args=dict(airline_code='HY',provider='uzbekistan',origin='TAS',destination='JED',date='2026-12-15',source_url='https://booking.uzairways.com/')
  self.assertIsNone(parse_offer_card('TAS JED HY 432 $200 $300',**args))
  self.assertIsNone(parse_offer_card('TAS JED $200',**args))
  self.assertIsNone(parse_offer_card('TAS JED XY 432 $200',**args))
 def test_wrong_provider(self):
  self.assertIsNone(parse_offer_card('TAS JED HY 321 USD 300',airline_code='HY',provider='centrum',origin='TAS',destination='JED',date='2026-12-15',source_url='https://b2c.centrum-air.com/'))
if __name__=='__main__': unittest.main()
