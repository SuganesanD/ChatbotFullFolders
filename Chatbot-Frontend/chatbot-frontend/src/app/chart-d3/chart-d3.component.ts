import {
  Component,
  Input,
  OnInit,
  AfterViewInit,
  ElementRef,
  ViewChild,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

@Component({
  selector: 'app-chart-d3',
  standalone: true,
  imports: [CommonModule],
  template: `<div #chartContainer class="chart-container" style="margin-top: 20px;"></div>`,
  styles: [`
    .chart-container {
      width: 100%;
      max-width: 600px;
      height: 400px;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `]
})
export class ChartD3Component implements OnInit, AfterViewInit, OnChanges {
  @Input() labels: string[] = [];
  @Input() data: number[] = [];
  @Input() chartType: 'bar' | 'line' | 'pie' | 'donut' = 'bar';

  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;

  constructor() {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] || changes['labels'] || changes['chartType']) {
      this.renderChart();
    }
  }

  renderChart(): void {
    const element = this.chartContainer.nativeElement;
    d3.select(element).selectAll('*').remove();

    const width = 600;
    const height = 400;

    const svg = d3.select(element)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const margin = { top: 20, right: 30, bottom: 50, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(this.labels)
      .range([0, innerWidth])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(this.data) || 0])
      .range([innerHeight, 0]);

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    if (this.chartType === 'bar') {
      g.append('g').call(d3.axisLeft(y));
      g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x));

      g.selectAll('rect')
        .data(this.data)
        .enter()
        .append('rect')
        .attr('x', (_, i: number) => x(this.labels[i])!)
        .attr('y', (d: number) => y(d))
        .attr('width', x.bandwidth())
        .attr('height', (d: number) => innerHeight - y(d))
        .attr('fill', (_, i: number) => color(i.toString()));
    }

    else if (this.chartType === 'line') {
      const line = d3.line<number>()
        .x((_, i: number) => x(this.labels[i])! + x.bandwidth() / 2)
        .y((d: number) => y(d));

      g.append('g').call(d3.axisLeft(y));
      g.append('g').attr('transform', `translate(0,${innerHeight})`).call(d3.axisBottom(x));

      g.append('path')
        .datum(this.data)
        .attr('fill', 'none')
        .attr('stroke', 'steelblue')
        .attr('stroke-width', 2)
        .attr('d', line);
    }

    else if (this.chartType === 'pie' || this.chartType === 'donut') {
      const radius = Math.min(innerWidth, innerHeight) / 2;
      const pieGroup = svg.append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);

      const pie = d3.pie<number>().value((d: number) => d);
      const pieData = pie(this.data);

      const arc = d3.arc<d3.PieArcDatum<number>>()
        .innerRadius(this.chartType === 'donut' ? radius / 2 : 0)
        .outerRadius(radius);

      pieGroup.selectAll('path')
        .data(pieData)
        .enter()
        .append('path')
        .attr('d', arc as any)
        .attr('fill', (_: d3.PieArcDatum<number>, i: number) => color(i.toString()))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1);

      pieGroup.selectAll('text')
        .data(pieData)
        .enter()
        .append('text')
        .attr('transform', (d: d3.PieArcDatum<number>) => `translate(${arc.centroid(d)})`)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('fill', '#000')
        .text((d: d3.PieArcDatum<number>) => {
          const index = this.data.indexOf(d.data);
          return this.labels[index] || '';
        });
    }
  }
}
