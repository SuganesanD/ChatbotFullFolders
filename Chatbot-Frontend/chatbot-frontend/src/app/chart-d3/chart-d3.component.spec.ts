import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChartD3Component } from './chart-d3.component';

describe('ChartD3Component', () => {
  let component: ChartD3Component;
  let fixture: ComponentFixture<ChartD3Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChartD3Component]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ChartD3Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
