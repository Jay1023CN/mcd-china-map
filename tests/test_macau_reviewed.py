"""Reviewed public-source links preserve identity, address scope and provenance."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import sync_store_catalog as C
BASE = ROOT/'docs/growth-assets/national-store-research'


class MacauTests(unittest.TestCase):
    def test_existing_ids_preserved_and_one_independently_supported_branch_added(self):
        stores, source = C.import_macau(BASE/'macau-tourism-license-partial.json')
        directory = C.read(BASE/'macau-directory-cross-check.json')['rows']
        existing = {('mo:mgto:'+r['government_license_match']['official_id']) if r.get('government_license_match') else
                    'mo:directory:'+hashlib.sha256(r['phone'].encode()).hexdigest()[:20] for r in directory}
        self.assertEqual(len(stores),39)
        self.assertTrue(existing.issubset({s['id'] for s in stores}))
        new = next(s for s in stores if s['directory_phone']=='28373930')
        self.assertEqual(new['id'],'mo:directory:'+hashlib.sha256(b'28373930').hexdigest()[:20])
        self.assertNotIn(new['id'],existing)
        self.assertEqual(new['address'],'澳門高美士街124-126號利新大廈地下A座')
        self.assertIn('閣樓',new['iam_address'])
        self.assertNotIn('location',new)
        self.assertFalse(new['current_open_status_verified'])
        self.assertEqual(source['reviewed_iam_sources']['existing_store_matches'],10)
        self.assertEqual(source['reviewed_iam_sources']['matched_store_records'],11)
        self.assertEqual(source['official_venue_visitor_pages']['rows'],7)
        by_phone = {s['directory_phone']:s for s in stores}
        self.assertIn('溜冰路128號',by_phone['28870082']['address'])
        self.assertIn('F07',by_phone['28870082']['venue_location'])
        for row in C.read(BASE/'macau-iam-directory-crosswalk.json')['rows']:
            if row['relationship'] in {'address_candidate','address_conflict'}:
                self.assertNotIn('iam_source_url',by_phone[row['directory_phone']])
                expected = by_phone[row['directory_phone']].get('venue_address') or row['directory_address']
                self.assertEqual(by_phone[row['directory_phone']]['address'],expected)

    def test_stale_source_requires_new_review_and_crlf_does_not_change_evidence(self):
        stores,_ = C.import_macau(BASE/'macau-tourism-license-partial.json')
        existing = [s for s in stores if s['directory_phone']!='28373930']
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            for filename in ('macau-iam-license-snapshot.json','macau-directory-cross-check.json',
                             'macau-event-merchant-snapshot.json','macau-tourism-license-partial.json','macau-iam-directory-crosswalk.json'):
                (base/filename).write_bytes((BASE/filename).read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
            result=C.apply_macau_reviewed_sources(copy.deepcopy(existing),base)
            self.assertEqual(result['matched_store_records'],11)
            path=base/'macau-iam-license-snapshot.json'
            source=C.read(path);source['rows'][0]['address']='变更后的地址'
            path.write_text(json.dumps(source,ensure_ascii=False),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'reviewed input changed'):
                C.apply_macau_reviewed_sources(copy.deepcopy(existing),base)

    def test_candidate_cannot_be_promoted_by_changing_only_eligibility_flag(self):
        stores,_ = C.import_macau(BASE/'macau-tourism-license-partial.json')
        existing=[s for s in stores if s['directory_phone']!='28373930']
        cross=C.read(BASE/'macau-iam-directory-crosswalk.json')
        cross['rows'][2]['eligible_to_attach_iam_source']=True
        original_read=C.read
        from unittest.mock import patch
        with patch.object(C,'read',side_effect=lambda p:cross if p.name=='macau-iam-directory-crosswalk.json' else original_read(p)):
            with self.assertRaisesRegex(ValueError,'Unconfirmed Macau relationship'):
                C.apply_macau_reviewed_sources(existing,BASE)


if __name__=='__main__':unittest.main()
