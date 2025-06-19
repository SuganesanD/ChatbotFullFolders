import { TestBed } from '@angular/core/testing';

import { CouchdbService } from './couchdb.service';

describe('CouchdbService', () => {
  let service: CouchdbService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CouchdbService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
