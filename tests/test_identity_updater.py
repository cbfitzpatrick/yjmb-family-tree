"""No private member data: deterministic synthetic identity and relationship tests."""
import copy
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openpyxl import Workbook
from apply_secure_submission import apply_addition, discover, ReviewRequired, rows_matching_person, create_missing_people_for_claims

HEADERS = [
  'Given/Preferred Name','Nickname','Family/Maiden Name','Married Name',
  'RAT Year','Instrument','VET','RAT 1','RAT 2',
  'Tree Display Name Preference','Tree Display Last Name Preference',
]

def workbook():
    wb=Workbook(); ws=wb.active
    ws.append(HEADERS)
    ws.append(['Matt','','Jackson','',2007,'Saxophone','','','','Given/Preferred Name','Maiden/Family Name'])
    ws.append(['Matt','','Jackson','',2007,'Battery','','','','Given/Preferred Name','Maiden/Family Name'])
    return ws,discover(ws)

def addition(decision='create', existing_id=None, rejected=None, given='Matt', family='Jackson', year=2007, section='trumpet'):
    return {
       'version':6, 'identityDecision':decision, 'existingPersonId':existing_id,
       'differentPersonIds':rejected or [],
       'self': {
           'givenPreferredName':given,'familyMaidenName':family,'ratYear':year,
           'section':section, 'sections':[{'section':section}],
           'treeNamePreference':'given','leadershipHistory':[], 'bandClubLeadershipHistory':[],
       },
       'rats':[], 'vet':None, 'notes':{}, 'pairSystem':{'applies':False}
    }

class TestExplicitIdentity(unittest.TestCase):
    def run_add(self,payload):
        ws,parts=workbook()
        result=apply_addition(ws,*parts,payload,[])
        return ws,result

    def test_new_same_name_year_after_rejecting_both(self):
        ws,(row,description)=self.run_add(addition(rejected=['row-2','row-3']))
        self.assertEqual(row,4)
        self.assertEqual(ws.max_row,4)
        self.assertEqual(ws['F2'].value,'Saxophone')
        self.assertEqual(ws['F3'].value,'Battery')
        self.assertEqual(ws['F4'].value,'Trumpet')
        self.assertEqual(len(rows_matching_person(ws,1,{'given':1,'family':3,'year':5},'Matt Jackson',2007)),3)

    def test_yes_merges_only_selected_profile(self):
        ws,(row,description)=self.run_add(addition(decision='merge',existing_id='row-3',section='battery'))
        self.assertEqual(row,3)
        self.assertEqual(ws.max_row,3)
        self.assertEqual(ws['F2'].value,'Saxophone')
        self.assertIn('Battery',ws['F3'].value)

    def test_cannot_create_before_rejecting_all(self):
        with self.assertRaises(ReviewRequired): self.run_add(addition(rejected=['row-2']))

    def test_cannot_auto_merge_legacy_submission(self):
        payload=addition();payload.pop('identityDecision');payload.pop('differentPersonIds')
        with self.assertRaises(ReviewRequired): self.run_add(payload)

    def test_cannot_merge_stale_or_wrong_person(self):
        with self.assertRaises(ReviewRequired):self.run_add(addition(decision='merge',existing_id='row-999'))

    def test_new_unmatched_name_is_allowed(self):
        ws,(row,_)=self.run_add(addition(given='Alex',family='Example',rejected=[]))
        self.assertEqual(row,4)
        self.assertEqual(ws['A4'].value,'Alex')

    def test_relationship_homonym_requires_confirmation(self):
        ws,(header,mapping,rats,labels,lookup)=workbook()
        # Test relation to an existing name/year is never silently selected.
        with self.assertRaises(ReviewRequired):
            create_missing_people_for_claims(ws,header,3,mapping,rats,labels,
                [('RAT','Matt Jackson (2007) (Saxophone)',None,[])],[])

    def test_relationship_can_create_different_person_after_rejections(self):
        ws,(header,mapping,rats,labels,lookup)=workbook()
        # Source row must not share the submitted person's name/year.
        ws.append(['Parent','','Example','',2005,'Trumpet','','','','',''])
        created=create_missing_people_for_claims(ws,header,4,mapping,rats,labels,
            [('RAT','Matt Jackson (2007) (Saxophone)',None,['row-2','row-3'])],[])
        self.assertEqual(ws.max_row,5)
        self.assertEqual(ws['A5'].value,'Matt')
        self.assertEqual(ws['G5'].value,'Parent Example (2005) (Trumpet)')

if __name__=='__main__': unittest.main()
