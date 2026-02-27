/**
 * VEHICLE DATABASE — Fahrzeugvorlagen für TankLog
 *
 * Struktur: Marke → Modell → Generation → Variante
 * Jede Variante enthält: Motorcode, Kraftstoff, Öl, Reifengrößen, PS
 */

const VehicleDB = {

  brands: {

    // ═══════════════════════════════════════════════════════════
    //  VOLKSWAGEN
    // ═══════════════════════════════════════════════════════════
    'Volkswagen': {
      models: {

        'Golf': {
          'Golf IV (1J) 1997–2003': [
            { name: '1.4 16V 75 PS',    code: 'AXP',  fuel: 'Benzin',  oil: '5W-40', power: 75,  tires: ['175/80 R14','185/60 R14','195/65 R15'] },
            { name: '1.6 8V 102 PS',    code: 'AEH',  fuel: 'Benzin',  oil: '5W-40', power: 102, tires: ['185/60 R14','195/65 R15'] },
            { name: '1.8 T 150 PS',     code: 'AGU',  fuel: 'Benzin',  oil: '5W-40', power: 150, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.9 TDI 90 PS',    code: 'AGR',  fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['185/60 R14','195/65 R15'] },
            { name: '1.9 TDI 100 PS',   code: 'ASV',  fuel: 'Diesel',  oil: '5W-30', power: 100, tires: ['195/65 R15'] },
            { name: '2.8 VR6 204 PS GTI', code: 'AUE', fuel: 'Benzin', oil: '5W-40', power: 204, tires: ['205/55 R16','225/45 R17'] },
          ],
          'Golf V (1K) 2003–2008': [
            { name: '1.4 FSI 90 PS',    code: 'BKG',  fuel: 'Benzin',  oil: '5W-40', power: 90,  tires: ['195/65 R15','205/55 R16'] },
            { name: '1.4 TSI 140 PS',   code: 'BLG',  fuel: 'Benzin',  oil: '5W-40', power: 140, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.6 FSI 115 PS',   code: 'BAG',  fuel: 'Benzin',  oil: '5W-40', power: 115, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 FSI 150 PS',   code: 'AXW',  fuel: 'Benzin',  oil: '5W-40', power: 150, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 GTI 200 PS',   code: 'AXX',  fuel: 'Benzin',  oil: '5W-40', power: 200, tires: ['225/45 R17'] },
            { name: '1.9 TDI 105 PS',   code: 'BXE',  fuel: 'Diesel',  oil: '5W-30', power: 105, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 TDI 136 PS',   code: 'BMM',  fuel: 'Diesel',  oil: '5W-30', power: 136, tires: ['205/55 R16','225/45 R17'] },
            { name: '3.2 R32 250 PS',   code: 'BFH',  fuel: 'Benzin',  oil: '5W-40', power: 250, tires: ['235/40 R18'] },
          ],
          'Golf VI (5K) 2008–2013': [
            { name: '1.2 TSI 85 PS',    code: 'CBZB', fuel: 'Benzin',  oil: '5W-30', power: 85,  tires: ['185/60 R15','195/65 R15','205/55 R16'] },
            { name: '1.2 TSI 105 PS',   code: 'CBZA', fuel: 'Benzin',  oil: '5W-30', power: 105, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.4 TSI 122 PS',   code: 'CAXA', fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['195/65 R15','205/55 R16','215/45 R17'] },
            { name: '1.4 TSI 160 PS',   code: 'CTHD', fuel: 'Benzin',  oil: '5W-30', power: 160, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 GTI 210 PS',   code: 'CCZB', fuel: 'Benzin',  oil: '5W-40', power: 210, tires: ['225/45 R17','235/35 R18'] },
            { name: '2.0 R 270 PS',     code: 'CDLF', fuel: 'Benzin',  oil: '5W-40', power: 270, tires: ['235/35 R18','235/35 R19'] },
            { name: '1.6 TDI 90 PS',    code: 'CAYB', fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['185/60 R15','195/65 R15','205/55 R16'] },
            { name: '1.6 TDI 105 PS',   code: 'CAYC', fuel: 'Diesel',  oil: '5W-30', power: 105, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 TDI 110 PS',   code: 'CBAB', fuel: 'Diesel',  oil: '5W-30', power: 110, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 TDI 140 PS',   code: 'CBDC', fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['205/55 R16','225/45 R17'] },
          ],
          'Golf VII (5G) 2012–2020': [
            { name: '1.0 TSI 85 PS',    code: 'CHYA', fuel: 'Benzin',  oil: '0W-30', power: 85,  tires: ['195/65 R15','205/55 R16'] },
            { name: '1.0 TSI 110 PS',   code: 'DKRF', fuel: 'Benzin',  oil: '0W-30', power: 110, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.2 TSI 85 PS',    code: 'CJZB', fuel: 'Benzin',  oil: '5W-30', power: 85,  tires: ['195/65 R15','205/55 R16'] },
            { name: '1.4 TSI 125 PS',   code: 'CZCA', fuel: 'Benzin',  oil: '0W-30', power: 125, tires: ['195/65 R15','205/55 R16','225/45 R17'] },
            { name: '1.4 GTE Hybrid',   code: 'CUKB', fuel: 'Hybrid (Benzin)', oil: '0W-30', power: 204, tires: ['215/40 R17','225/40 R18'] },
            { name: '2.0 GTI 220 PS',   code: 'CHHA', fuel: 'Benzin',  oil: '5W-40', power: 220, tires: ['225/45 R17','225/40 R18'] },
            { name: '2.0 GTI Performance 230 PS', code: 'CHHB', fuel: 'Benzin', oil: '5W-40', power: 230, tires: ['225/40 R18'] },
            { name: '2.0 R 300 PS',     code: 'CJXC', fuel: 'Benzin',  oil: '5W-40', power: 300, tires: ['235/35 R19'] },
            { name: '1.6 TDI 90 PS',    code: 'CLHA', fuel: 'Diesel',  oil: '0W-30', power: 90,  tires: ['195/65 R15','205/55 R16'] },
            { name: '1.6 TDI 110 PS',   code: 'CRKB', fuel: 'Diesel',  oil: '0W-30', power: 110, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 TDI 115 PS',   code: 'CRKC', fuel: 'Diesel',  oil: '0W-30', power: 115, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 TDI 150 PS',   code: 'CRVA', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['205/55 R16','225/45 R17'] },
          ],
          'Golf VIII (CD1) 2020–': [
            { name: '1.0 TSI 90 PS',    code: 'DLAA', fuel: 'Benzin',  oil: '0W-20', power: 90,  tires: ['205/55 R16','215/45 R17'] },
            { name: '1.0 TSI 110 PS',   code: 'DKRF', fuel: 'Benzin',  oil: '0W-20', power: 110, tires: ['205/55 R16','215/45 R17'] },
            { name: '1.5 TSI 130 PS',   code: 'DPCA', fuel: 'Benzin',  oil: '0W-20', power: 130, tires: ['205/55 R16','225/45 R17'] },
            { name: '1.5 eTSI 150 PS Hybrid', code: 'DPBA', fuel: 'Hybrid (Benzin)', oil: '0W-20', power: 150, tires: ['215/45 R17','225/40 R18'] },
            { name: '2.0 GTI 245 PS',   code: 'DNFA', fuel: 'Benzin',  oil: '5W-30', power: 245, tires: ['225/40 R18','235/35 R19'] },
            { name: '2.0 R 320 PS',     code: 'DNUE', fuel: 'Benzin',  oil: '5W-30', power: 320, tires: ['235/35 R19'] },
            { name: '2.0 TDI 115 PS',   code: 'DTNA', fuel: 'Diesel',  oil: '0W-20', power: 115, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 TDI 150 PS',   code: 'DTSA', fuel: 'Diesel',  oil: '0W-20', power: 150, tires: ['205/55 R16','225/45 R17'] },
          ],
        },

        'Polo': {
          'Polo V (6R/6C) 2009–2017': [
            { name: '1.0 MPI 60 PS',    code: 'CHYA', fuel: 'Benzin',  oil: '5W-30', power: 60,  tires: ['175/65 R14','185/60 R14','195/55 R15'] },
            { name: '1.2 TSI 90 PS',    code: 'CBZC', fuel: 'Benzin',  oil: '5W-30', power: 90,  tires: ['185/60 R14','195/55 R15','205/45 R16'] },
            { name: '1.2 TSI 105 PS',   code: 'CBZB', fuel: 'Benzin',  oil: '5W-30', power: 105, tires: ['195/55 R15','205/45 R16'] },
            { name: '1.4 16V 85 PS',    code: 'BBY',  fuel: 'Benzin',  oil: '5W-40', power: 85,  tires: ['185/60 R14','195/55 R15'] },
            { name: 'GTI 1.4 TSI 180 PS', code: 'CAVE', fuel: 'Benzin', oil: '5W-40', power: 180, tires: ['215/40 R17'] },
            { name: '1.2 TDI 75 PS',    code: 'CFWA', fuel: 'Diesel',  oil: '5W-30', power: 75,  tires: ['175/65 R14','185/60 R14'] },
            { name: '1.6 TDI 75 PS',    code: 'CAYA', fuel: 'Diesel',  oil: '5W-30', power: 75,  tires: ['185/60 R14','195/55 R15'] },
            { name: '1.6 TDI 90 PS',    code: 'CAYB', fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['185/60 R14','195/55 R15'] },
          ],
          'Polo VI (AW1) 2017–': [
            { name: '1.0 MPI 65 PS',    code: 'CHYB', fuel: 'Benzin',  oil: '0W-20', power: 65,  tires: ['185/65 R15','195/55 R16'] },
            { name: '1.0 TSI 95 PS',    code: 'DKLA', fuel: 'Benzin',  oil: '0W-20', power: 95,  tires: ['195/55 R16','205/45 R17'] },
            { name: '1.0 TSI 110 PS',   code: 'DKRF', fuel: 'Benzin',  oil: '0W-20', power: 110, tires: ['195/55 R16','205/45 R17'] },
            { name: 'GTI 2.0 TSI 207 PS', code: 'DKZC', fuel: 'Benzin', oil: '5W-30', power: 207, tires: ['215/40 R18'] },
          ],
        },

        'Passat': {
          'Passat B6 (3C) 2005–2010': [
            { name: '1.4 TSI 122 PS',   code: 'CAXA', fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['205/55 R16','215/50 R17'] },
            { name: '1.8 TSI 160 PS',   code: 'BZB',  fuel: 'Benzin',  oil: '5W-40', power: 160, tires: ['215/55 R16','215/50 R17'] },
            { name: '2.0 TSI 200 PS',   code: 'BWA',  fuel: 'Benzin',  oil: '5W-40', power: 200, tires: ['215/50 R17','225/45 R18'] },
            { name: '1.9 TDI 105 PS',   code: 'BXE',  fuel: 'Diesel',  oil: '5W-30', power: 105, tires: ['205/55 R16','215/50 R17'] },
            { name: '2.0 TDI 140 PS',   code: 'BMR',  fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['215/55 R16','215/50 R17'] },
            { name: '2.0 TDI 170 PS',   code: 'BMR',  fuel: 'Diesel',  oil: '5W-30', power: 170, tires: ['215/50 R17','225/45 R18'] },
          ],
          'Passat B7 (3C) 2010–2014': [
            { name: '1.4 TSI 122 PS',   code: 'CAXA', fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['205/55 R16','215/55 R16'] },
            { name: '1.8 TSI 160 PS',   code: 'CDAA', fuel: 'Benzin',  oil: '5W-30', power: 160, tires: ['215/55 R16','215/50 R17'] },
            { name: '2.0 TDI 140 PS',   code: 'CFGB', fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['215/55 R16','215/50 R17'] },
            { name: '2.0 TDI 170 PS',   code: 'CFGC', fuel: 'Diesel',  oil: '5W-30', power: 170, tires: ['215/50 R17','225/45 R18'] },
          ],
          'Passat B8 (3G) 2014–': [
            { name: '1.4 TSI 125 PS',   code: 'CZCA', fuel: 'Benzin',  oil: '0W-30', power: 125, tires: ['205/60 R16','215/55 R17'] },
            { name: '1.5 TSI 150 PS',   code: 'DPCA', fuel: 'Benzin',  oil: '0W-20', power: 150, tires: ['205/60 R16','215/55 R17'] },
            { name: '2.0 TSI 280 PS (R-Line)', code: 'CHHB', fuel: 'Benzin', oil: '5W-30', power: 280, tires: ['235/40 R18'] },
            { name: '1.6 TDI 120 PS',   code: 'DCXA', fuel: 'Diesel',  oil: '0W-30', power: 120, tires: ['205/60 R16','215/55 R17'] },
            { name: '2.0 TDI 150 PS',   code: 'CRVC', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['215/55 R17','225/45 R18'] },
            { name: '2.0 TDI 190 PS',   code: 'DFCA', fuel: 'Diesel',  oil: '0W-30', power: 190, tires: ['225/45 R18','235/40 R18'] },
          ],
        },

        'Tiguan': {
          'Tiguan I (5N) 2007–2016': [
            { name: '1.4 TSI 122 PS',   code: 'CAXA', fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['215/65 R16','235/55 R17'] },
            { name: '2.0 TSI 200 PS 4Motion', code: 'CAWB', fuel: 'Benzin', oil: '5W-30', power: 200, tires: ['235/55 R17','235/45 R18'] },
            { name: '2.0 TDI 140 PS',   code: 'CBAB', fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['215/65 R16','235/55 R17'] },
            { name: '2.0 TDI 170 PS 4Motion', code: 'CFGC', fuel: 'Diesel', oil: '5W-30', power: 170, tires: ['235/55 R17','235/45 R18'] },
          ],
          'Tiguan II (5N) 2016–': [
            { name: '1.4 TSI 125 PS',   code: 'CZDA', fuel: 'Benzin',  oil: '0W-30', power: 125, tires: ['215/65 R16','235/55 R17','235/50 R18'] },
            { name: '1.5 TSI 150 PS',   code: 'DPCA', fuel: 'Benzin',  oil: '0W-20', power: 150, tires: ['215/65 R16','235/55 R17'] },
            { name: '2.0 TSI 190 PS',   code: 'CZPB', fuel: 'Benzin',  oil: '5W-30', power: 190, tires: ['235/50 R18','235/45 R19'] },
            { name: '2.0 TSI R-Line 245 PS', code: 'DNPA', fuel: 'Benzin', oil: '5W-30', power: 245, tires: ['235/45 R19'] },
            { name: '2.0 TDI 150 PS',   code: 'DFGA', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['215/65 R16','235/55 R17'] },
            { name: '2.0 TDI 190 PS 4Motion', code: 'DFHA', fuel: 'Diesel', oil: '0W-30', power: 190, tires: ['235/50 R18','235/45 R19'] },
          ],
        },

        'Touareg': {
          'Touareg II (7P) 2010–2018': [
            { name: '3.0 TDI 245 PS',   code: 'CVWA', fuel: 'Diesel',  oil: '5W-30', power: 245, tires: ['255/55 R18','255/50 R19'] },
            { name: '3.6 V6 FSI 280 PS',code: 'CGRA', fuel: 'Benzin',  oil: '5W-40', power: 280, tires: ['255/55 R18','275/45 R20'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  AUDI
    // ═══════════════════════════════════════════════════════════
    'Audi': {
      models: {
        'A3': {
          'A3 8P 2003–2012': [
            { name: '1.2 TFSI 86 PS',   code: 'CBZB', fuel: 'Benzin',  oil: '5W-30', power: 86,  tires: ['195/65 R15','205/55 R16'] },
            { name: '1.4 TFSI 125 PS',  code: 'CAXC', fuel: 'Benzin',  oil: '5W-30', power: 125, tires: ['205/55 R16','225/45 R17'] },
            { name: '1.6 FSI 115 PS',   code: 'BAG',  fuel: 'Benzin',  oil: '5W-40', power: 115, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.8 TFSI 160 PS',  code: 'BYT',  fuel: 'Benzin',  oil: '5W-30', power: 160, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 TFSI S3 265 PS', code: 'CDLF', fuel: 'Benzin', oil: '5W-40', power: 265, tires: ['235/40 R18'] },
            { name: '1.9 TDI 105 PS',   code: 'BXE',  fuel: 'Diesel',  oil: '5W-30', power: 105, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 TDI 140 PS',   code: 'BMM',  fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['205/55 R16','225/45 R17'] },
          ],
          'A3 8V 2012–2020': [
            { name: '1.0 TFSI 116 PS',  code: 'CHZB', fuel: 'Benzin',  oil: '0W-30', power: 116, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.4 TFSI 122 PS',  code: 'CZCA', fuel: 'Benzin',  oil: '0W-30', power: 122, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.5 TFSI 150 PS',  code: 'DADA', fuel: 'Benzin',  oil: '0W-20', power: 150, tires: ['205/60 R16','225/45 R17'] },
            { name: '2.0 TFSI S3 300 PS', code: 'CJXF', fuel: 'Benzin', oil: '5W-40', power: 300, tires: ['225/40 R18','235/35 R19'] },
            { name: '1.6 TDI 110 PS',   code: 'CRKB', fuel: 'Diesel',  oil: '0W-30', power: 110, tires: ['205/60 R16','225/45 R17'] },
            { name: '2.0 TDI 150 PS',   code: 'CRVC', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['225/45 R17','235/40 R18'] },
          ],
        },
        'A4': {
          'A4 B7 (8E) 2004–2008': [
            { name: '1.8 TFSI 163 PS',  code: 'BFB',  fuel: 'Benzin',  oil: '5W-40', power: 163, tires: ['205/60 R16','225/55 R16'] },
            { name: '2.0 TFSI 200 PS',  code: 'BGB',  fuel: 'Benzin',  oil: '5W-40', power: 200, tires: ['225/55 R16','225/50 R17'] },
            { name: '3.2 FSI 255 PS',   code: 'BKH',  fuel: 'Benzin',  oil: '5W-40', power: 255, tires: ['225/50 R17','235/40 R18'] },
            { name: '2.0 TDI 140 PS',   code: 'BPW',  fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['205/60 R16','225/55 R16'] },
          ],
          'A4 B8 (8K) 2008–2015': [
            { name: '1.8 TFSI 120 PS',  code: 'CDHA', fuel: 'Benzin',  oil: '5W-30', power: 120, tires: ['205/60 R16','225/50 R17'] },
            { name: '2.0 TFSI 180 PS',  code: 'CDNB', fuel: 'Benzin',  oil: '5W-30', power: 180, tires: ['225/50 R17','235/45 R18'] },
            { name: '2.0 TDI 143 PS',   code: 'CAGB', fuel: 'Diesel',  oil: '5W-30', power: 143, tires: ['205/60 R16','225/50 R17'] },
            { name: '2.0 TDI 177 PS',   code: 'CAHA', fuel: 'Diesel',  oil: '5W-30', power: 177, tires: ['225/50 R17','235/45 R18'] },
          ],
          'A4 B9 (8W) 2015–': [
            { name: '2.0 TFSI 190 PS',  code: 'CYMC', fuel: 'Benzin',  oil: '0W-30', power: 190, tires: ['225/55 R17','245/45 R18'] },
            { name: '2.0 TFSI 252 PS',  code: 'CYRB', fuel: 'Benzin',  oil: '5W-30', power: 252, tires: ['245/45 R18','245/40 R19'] },
            { name: '2.0 TDI 150 PS',   code: 'DEUA', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['225/55 R17','245/45 R18'] },
            { name: '2.0 TDI 190 PS',   code: 'DETA', fuel: 'Diesel',  oil: '0W-30', power: 190, tires: ['245/45 R18','245/40 R19'] },
          ],
        },
        'A6': {
          'A6 C7 (4G) 2011–2018': [
            { name: '2.0 TFSI 180 PS',  code: 'CDNB', fuel: 'Benzin',  oil: '5W-30', power: 180, tires: ['225/60 R16','245/45 R18'] },
            { name: '3.0 TFSI 300 PS',  code: 'CTYA', fuel: 'Benzin',  oil: '5W-40', power: 300, tires: ['255/40 R19'] },
            { name: '2.0 TDI 177 PS',   code: 'CAHA', fuel: 'Diesel',  oil: '5W-30', power: 177, tires: ['225/60 R16','245/45 R18'] },
            { name: '3.0 TDI 204 PS',   code: 'CDUC', fuel: 'Diesel',  oil: '5W-30', power: 204, tires: ['245/45 R18','255/40 R19'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  BMW
    // ═══════════════════════════════════════════════════════════
    'BMW': {
      models: {
        '1er': {
          '1er E87 2004–2011': [
            { name: '116i 115 PS',      code: 'N45B16A', fuel: 'Benzin',  oil: '5W-30', power: 115, tires: ['195/65 R15','205/55 R16'] },
            { name: '120i 170 PS',      code: 'N46B20B', fuel: 'Benzin',  oil: '5W-30', power: 170, tires: ['205/55 R16','225/45 R17'] },
            { name: '130i 265 PS',      code: 'N52B30A', fuel: 'Benzin',  oil: '5W-30', power: 265, tires: ['225/45 R17','225/40 R18'] },
            { name: '116d 116 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 116, tires: ['195/65 R15','205/55 R16'] },
            { name: '118d 143 PS',      code: 'N47D20A', fuel: 'Diesel',  oil: '5W-30', power: 143, tires: ['205/55 R16','225/45 R17'] },
          ],
          '1er F20 2011–2019': [
            { name: '116i 136 PS',      code: 'N13B16A', fuel: 'Benzin',  oil: '5W-30', power: 136, tires: ['195/65 R15','205/55 R16'] },
            { name: '118i 136 PS',      code: 'B38A15A', fuel: 'Benzin',  oil: '5W-30', power: 136, tires: ['205/55 R16','225/45 R17'] },
            { name: '120i 184 PS',      code: 'N20B20A', fuel: 'Benzin',  oil: '5W-30', power: 184, tires: ['225/45 R17','225/40 R18'] },
            { name: 'M135i xDrive 320 PS', code: 'N55B30A', fuel: 'Benzin', oil: '5W-30', power: 320, tires: ['225/40 R18','245/35 R18'] },
            { name: '116d 116 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 116, tires: ['195/65 R15','205/55 R16'] },
            { name: '118d 143 PS',      code: 'N47D20A', fuel: 'Diesel',  oil: '5W-30', power: 143, tires: ['205/55 R16','225/45 R17'] },
          ],
        },
        '3er': {
          '3er E90/91/92/93 2005–2012': [
            { name: '316i 122 PS',      code: 'N45B16A', fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['195/65 R15','205/55 R16'] },
            { name: '318i 143 PS',      code: 'N46B20B', fuel: 'Benzin',  oil: '5W-30', power: 143, tires: ['205/55 R16','225/45 R17'] },
            { name: '320i 170 PS',      code: 'N46B20B', fuel: 'Benzin',  oil: '5W-30', power: 170, tires: ['205/55 R16','225/45 R17'] },
            { name: '325i 218 PS',      code: 'N52B25A', fuel: 'Benzin',  oil: '5W-30', power: 218, tires: ['225/50 R17','225/45 R18'] },
            { name: '330i 272 PS',      code: 'N52B30A', fuel: 'Benzin',  oil: '5W-30', power: 272, tires: ['225/45 R17','225/40 R18'] },
            { name: 'M3 420 PS',        code: 'S65B40A', fuel: 'Benzin',  oil: '10W-60',power: 420, tires: ['245/40 R18','265/40 R18'] },
            { name: '316d 116 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 116, tires: ['195/65 R15','205/55 R16'] },
            { name: '318d 143 PS',      code: 'N47D20A', fuel: 'Diesel',  oil: '5W-30', power: 143, tires: ['205/55 R16','225/45 R17'] },
            { name: '320d 177 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 177, tires: ['225/50 R17','225/45 R18'] },
            { name: '330d 245 PS',      code: 'M57D30U2', fuel: 'Diesel', oil: '5W-30', power: 245, tires: ['225/45 R17','225/40 R18'] },
          ],
          '3er F30/31/34 2012–2019': [
            { name: '316i 136 PS',      code: 'N13B16A', fuel: 'Benzin',  oil: '5W-30', power: 136, tires: ['205/60 R16','225/50 R17'] },
            { name: '320i 184 PS',      code: 'N20B20A', fuel: 'Benzin',  oil: '5W-30', power: 184, tires: ['225/50 R17','225/45 R18'] },
            { name: '328i 245 PS',      code: 'N20B20B', fuel: 'Benzin',  oil: '5W-30', power: 245, tires: ['225/50 R17','225/45 R18'] },
            { name: 'M3 431 PS',        code: 'S55B30A', fuel: 'Benzin',  oil: '10W-60',power: 431, tires: ['245/40 R18','265/40 R18'] },
            { name: '316d 116 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 116, tires: ['205/60 R16','225/50 R17'] },
            { name: '318d 143 PS',      code: 'B47D20A', fuel: 'Diesel',  oil: '5W-30', power: 143, tires: ['225/50 R17','225/45 R18'] },
            { name: '320d 184 PS',      code: 'B47D20A', fuel: 'Diesel',  oil: '5W-30', power: 184, tires: ['225/50 R17','225/45 R18'] },
            { name: '330d 258 PS',      code: 'N57D30A', fuel: 'Diesel',  oil: '5W-30', power: 258, tires: ['225/45 R18','245/40 R18'] },
          ],
          '3er G20/21 2019–': [
            { name: '320i 184 PS',      code: 'B48B20A', fuel: 'Benzin',  oil: '0W-30', power: 184, tires: ['225/55 R17','225/45 R18'] },
            { name: '330i 258 PS',      code: 'B48B20B', fuel: 'Benzin',  oil: '0W-30', power: 258, tires: ['225/45 R18','255/40 R19'] },
            { name: 'M3 Comp. 510 PS',  code: 'S58B30A', fuel: 'Benzin',  oil: '10W-60',power: 510, tires: ['255/35 R19','285/30 R20'] },
            { name: '318d 150 PS',      code: 'B47D20B', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['225/55 R17','225/45 R18'] },
            { name: '320d 190 PS',      code: 'B47D20B', fuel: 'Diesel',  oil: '0W-30', power: 190, tires: ['225/45 R18','255/40 R19'] },
          ],
        },
        '5er': {
          '5er F10/11 2010–2017': [
            { name: '520i 184 PS',      code: 'N20B20A', fuel: 'Benzin',  oil: '5W-30', power: 184, tires: ['225/60 R16','245/45 R17'] },
            { name: '528i 245 PS',      code: 'N20B20B', fuel: 'Benzin',  oil: '5W-30', power: 245, tires: ['245/45 R18','245/40 R19'] },
            { name: 'M5 560 PS',        code: 'S63B44A', fuel: 'Benzin',  oil: '10W-60',power: 560, tires: ['265/35 R20','295/30 R20'] },
            { name: '518d 143 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 143, tires: ['225/60 R16','245/45 R17'] },
            { name: '520d 184 PS',      code: 'N47D20C', fuel: 'Diesel',  oil: '5W-30', power: 184, tires: ['225/60 R16','245/45 R17'] },
            { name: '530d 258 PS',      code: 'N57D30A', fuel: 'Diesel',  oil: '5W-30', power: 258, tires: ['245/45 R18','245/40 R19'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  MERCEDES-BENZ
    // ═══════════════════════════════════════════════════════════
    'Mercedes-Benz': {
      models: {
        'A-Klasse': {
          'A-Klasse W176 2012–2018': [
            { name: 'A 160 102 PS',     code: 'M270910',fuel: 'Benzin',  oil: '5W-30', power: 102, tires: ['195/65 R15','205/60 R16'] },
            { name: 'A 180 122 PS',     code: 'M270910',fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['205/60 R16','225/45 R17'] },
            { name: 'A 200 156 PS',     code: 'M270920',fuel: 'Benzin',  oil: '5W-30', power: 156, tires: ['225/45 R17','235/40 R18'] },
            { name: 'A 45 AMG 360 PS',  code: 'M133980',fuel: 'Benzin',  oil: '5W-40', power: 360, tires: ['235/35 R18','235/35 R19'] },
            { name: 'A 180 CDI 109 PS', code: 'OM607951',fuel:'Diesel',  oil: '5W-30', power: 109, tires: ['205/60 R16','225/45 R17'] },
            { name: 'A 200 CDI 136 PS', code: 'OM651913',fuel:'Diesel',  oil: '5W-30', power: 136, tires: ['225/45 R17','235/40 R18'] },
          ],
          'A-Klasse W177 2018–': [
            { name: 'A 160 109 PS',     code: 'M282914',fuel: 'Benzin',  oil: '0W-40', power: 109, tires: ['195/65 R15','205/55 R16'] },
            { name: 'A 180 136 PS',     code: 'M282914',fuel: 'Benzin',  oil: '0W-40', power: 136, tires: ['205/55 R16','225/45 R17'] },
            { name: 'A 200 163 PS',     code: 'M282914',fuel: 'Benzin',  oil: '0W-40', power: 163, tires: ['225/45 R17','225/40 R18'] },
            { name: 'A 45 S AMG 421 PS',code: 'M139980',fuel: 'Benzin',  oil: '5W-40', power: 421, tires: ['235/35 R19','255/35 R19'] },
            { name: 'A 180 d 116 PS',   code: 'OM608911',fuel:'Diesel',  oil: '5W-30', power: 116, tires: ['205/55 R16','225/45 R17'] },
            { name: 'A 220 d 190 PS',   code: 'OM654916',fuel:'Diesel',  oil: '5W-30', power: 190, tires: ['225/45 R17','225/40 R18'] },
          ],
        },
        'C-Klasse': {
          'C-Klasse W204 2007–2014': [
            { name: 'C 180 156 PS',     code: 'M271860',fuel: 'Benzin',  oil: '5W-40', power: 156, tires: ['205/55 R16','225/45 R17'] },
            { name: 'C 200 184 PS',     code: 'M274920',fuel: 'Benzin',  oil: '5W-30', power: 184, tires: ['205/55 R16','225/45 R17'] },
            { name: 'C 250 204 PS',     code: 'M274920',fuel: 'Benzin',  oil: '5W-30', power: 204, tires: ['225/45 R17','235/40 R18'] },
            { name: 'C 63 AMG 457 PS',  code: 'M156985',fuel: 'Benzin',  oil: '10W-60',power: 457, tires: ['235/40 R18','255/35 R18'] },
            { name: 'C 180 CDI 120 PS', code: 'OM651912',fuel:'Diesel',  oil: '5W-30', power: 120, tires: ['205/55 R16','225/45 R17'] },
            { name: 'C 220 CDI 170 PS', code: 'OM651913',fuel:'Diesel',  oil: '5W-30', power: 170, tires: ['225/45 R17','235/40 R18'] },
          ],
          'C-Klasse W205 2014–2021': [
            { name: 'C 180 156 PS',     code: 'M274910',fuel: 'Benzin',  oil: '5W-30', power: 156, tires: ['205/55 R16','225/50 R17'] },
            { name: 'C 200 184 PS',     code: 'M274920',fuel: 'Benzin',  oil: '5W-30', power: 184, tires: ['225/50 R17','225/45 R18'] },
            { name: 'C 300 258 PS',     code: 'M274922',fuel: 'Benzin',  oil: '5W-30', power: 258, tires: ['225/45 R18','245/40 R18'] },
            { name: 'C 63 AMG 476 PS',  code: 'M177980',fuel: 'Benzin',  oil: '5W-40', power: 476, tires: ['255/35 R19','285/30 R19'] },
            { name: 'C 220 d 170 PS',   code: 'OM651912',fuel:'Diesel',  oil: '5W-30', power: 170, tires: ['205/55 R16','225/50 R17'] },
            { name: 'C 220 d 194 PS',   code: 'OM654916',fuel:'Diesel',  oil: '5W-30', power: 194, tires: ['225/50 R17','225/45 R18'] },
          ],
        },
        'E-Klasse': {
          'E-Klasse W212 2009–2016': [
            { name: 'E 200 CGI 184 PS', code: 'M271860',fuel: 'Benzin',  oil: '5W-40', power: 184, tires: ['225/55 R16','245/45 R17'] },
            { name: 'E 350 CGI 292 PS', code: 'M272973',fuel: 'Benzin',  oil: '5W-40', power: 292, tires: ['245/45 R17','245/40 R18'] },
            { name: 'E 63 AMG 525 PS',  code: 'M157985',fuel: 'Benzin',  oil: '10W-60',power: 525, tires: ['255/35 R19','285/30 R20'] },
            { name: 'E 220 CDI 170 PS', code: 'OM651912',fuel:'Diesel',  oil: '5W-30', power: 170, tires: ['225/55 R16','245/45 R17'] },
            { name: 'E 220 d 194 PS',   code: 'OM651913',fuel:'Diesel',  oil: '5W-30', power: 194, tires: ['245/45 R17','245/40 R18'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  SKODA
    // ═══════════════════════════════════════════════════════════
    'Skoda': {
      models: {
        'Octavia': {
          'Octavia II (1Z) 2004–2013': [
            { name: '1.4 TSI 122 PS',   code: 'CAXA', fuel: 'Benzin',  oil: '5W-30', power: 122, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.6 MPI 102 PS',   code: 'BGU',  fuel: 'Benzin',  oil: '5W-40', power: 102, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.8 TSI 160 PS',   code: 'BZB',  fuel: 'Benzin',  oil: '5W-40', power: 160, tires: ['205/55 R16','225/45 R17'] },
            { name: 'RS 2.0 TSI 200 PS',code: 'BWA',  fuel: 'Benzin',  oil: '5W-40', power: 200, tires: ['225/45 R17'] },
            { name: '1.6 TDI 90 PS',    code: 'CAYC', fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['195/65 R15','205/55 R16'] },
            { name: '1.9 TDI 105 PS',   code: 'BXE',  fuel: 'Diesel',  oil: '5W-30', power: 105, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 TDI 140 PS',   code: 'BMM',  fuel: 'Diesel',  oil: '5W-30', power: 140, tires: ['205/55 R16','225/45 R17'] },
          ],
          'Octavia III (5E) 2012–2020': [
            { name: '1.0 TSI 115 PS',   code: 'CHZB', fuel: 'Benzin',  oil: '0W-30', power: 115, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.4 TSI 150 PS',   code: 'CZDA', fuel: 'Benzin',  oil: '0W-30', power: 150, tires: ['205/60 R16','225/45 R17'] },
            { name: 'RS 2.0 TSI 245 PS',code: 'DNFA', fuel: 'Benzin',  oil: '5W-30', power: 245, tires: ['225/40 R18'] },
            { name: '1.6 TDI 115 PS',   code: 'CRKB', fuel: 'Diesel',  oil: '0W-30', power: 115, tires: ['205/60 R16','225/45 R17'] },
            { name: '2.0 TDI 150 PS',   code: 'CRVC', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['225/45 R17','235/40 R18'] },
            { name: 'RS 2.0 TDI 184 PS',code: 'CUPA', fuel: 'Diesel',  oil: '0W-30', power: 184, tires: ['225/40 R18'] },
          ],
        },
        'Superb': {
          'Superb III (3V) 2015–': [
            { name: '1.4 TSI 150 PS',   code: 'CZDA', fuel: 'Benzin',  oil: '0W-30', power: 150, tires: ['215/60 R16','235/50 R18'] },
            { name: '1.5 TSI 150 PS',   code: 'DPCA', fuel: 'Benzin',  oil: '0W-20', power: 150, tires: ['215/60 R16','235/50 R18'] },
            { name: '2.0 TSI 280 PS',   code: 'CHHB', fuel: 'Benzin',  oil: '5W-30', power: 280, tires: ['245/40 R19'] },
            { name: '2.0 TDI 150 PS',   code: 'DFGA', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['215/60 R16','235/50 R18'] },
            { name: '2.0 TDI 190 PS',   code: 'DFHA', fuel: 'Diesel',  oil: '0W-30', power: 190, tires: ['235/50 R18','245/40 R19'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  SEAT
    // ═══════════════════════════════════════════════════════════
    'SEAT': {
      models: {
        'Ibiza': {
          'Ibiza IV (6J) 2008–2017': [
            { name: '1.2 TSI 90 PS',    code: 'CBZC', fuel: 'Benzin',  oil: '5W-30', power: 90,  tires: ['185/60 R15','195/55 R15'] },
            { name: '1.4 TSI 150 PS Cupra', code: 'CAVE', fuel: 'Benzin', oil: '5W-40', power: 150, tires: ['215/40 R17'] },
            { name: '1.6 TDI 90 PS',    code: 'CAYB', fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['185/60 R15','195/55 R15'] },
          ],
        },
        'Leon': {
          'Leon III (5F) 2012–2020': [
            { name: '1.2 TSI 110 PS',   code: 'CBZB', fuel: 'Benzin',  oil: '5W-30', power: 110, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.4 TSI 125 PS',   code: 'CZCA', fuel: 'Benzin',  oil: '0W-30', power: 125, tires: ['205/60 R16','225/45 R17'] },
            { name: 'Cupra 2.0 TSI 300 PS', code: 'CJXA', fuel: 'Benzin', oil: '5W-40', power: 300, tires: ['235/35 R19'] },
            { name: '1.6 TDI 110 PS',   code: 'CRKB', fuel: 'Diesel',  oil: '0W-30', power: 110, tires: ['205/60 R16','225/45 R17'] },
            { name: '2.0 TDI 150 PS',   code: 'CRVC', fuel: 'Diesel',  oil: '0W-30', power: 150, tires: ['225/45 R17'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  OPEL
    // ═══════════════════════════════════════════════════════════
    'Opel': {
      models: {
        'Astra': {
          'Astra J (P10) 2009–2015': [
            { name: '1.4 Turbo 120 PS', code: 'A14NET',fuel: 'Benzin',  oil: '5W-30', power: 120, tires: ['195/65 R15','205/55 R16'] },
            { name: '1.6 SIDI 170 PS',  code: 'A16XHT',fuel: 'Benzin',  oil: '5W-30', power: 170, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 OPC 280 PS',   code: 'A20NFT',fuel: 'Benzin',  oil: '5W-40', power: 280, tires: ['235/40 R18'] },
            { name: '1.6 CDTI 110 PS',  code: 'B16DTH',fuel: 'Diesel',  oil: '5W-30', power: 110, tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 CDTI 165 PS',  code: 'A20DTH',fuel: 'Diesel',  oil: '5W-30', power: 165, tires: ['205/55 R16','225/45 R17'] },
          ],
        },
        'Corsa': {
          'Corsa E (X15) 2014–2019': [
            { name: '1.0 Turbo 90 PS',  code: 'B10XFL',fuel: 'Benzin',  oil: '5W-30', power: 90,  tires: ['175/70 R14','185/65 R15'] },
            { name: '1.2 70 PS',        code: 'Z12XEP',fuel: 'Benzin',  oil: '5W-40', power: 70,  tires: ['175/70 R14','185/65 R15'] },
            { name: '1.4 Turbo 100 PS', code: 'B14NET',fuel: 'Benzin',  oil: '5W-30', power: 100, tires: ['185/65 R15','195/55 R16'] },
            { name: '1.3 CDTI 75 PS',   code: 'Z13DTH',fuel: 'Diesel',  oil: '5W-30', power: 75,  tires: ['175/70 R14','185/65 R15'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  FORD
    // ═══════════════════════════════════════════════════════════
    'Ford': {
      models: {
        'Focus': {
          'Focus III 2011–2018': [
            { name: '1.0 EcoBoost 100 PS', code: 'M1DA', fuel: 'Benzin',  oil: '5W-20', power: 100, tires: ['195/65 R15','215/50 R17'] },
            { name: '1.0 EcoBoost 125 PS', code: 'M2DA', fuel: 'Benzin',  oil: '5W-20', power: 125, tires: ['205/55 R16','215/50 R17'] },
            { name: '1.6 TI-VCT 125 PS',   code: 'MUDA', fuel: 'Benzin',  oil: '5W-20', power: 125, tires: ['205/55 R16','215/50 R17'] },
            { name: '2.0 ST 250 PS',       code: 'HJDA', fuel: 'Benzin',  oil: '5W-20', power: 250, tires: ['235/40 R18'] },
            { name: '1.6 TDCi 95 PS',      code: 'NGDB', fuel: 'Diesel',  oil: '5W-30', power: 95,  tires: ['195/65 R15','205/55 R16'] },
            { name: '2.0 TDCi 115 PS',     code: 'UFDA', fuel: 'Diesel',  oil: '5W-30', power: 115, tires: ['205/55 R16','215/50 R17'] },
            { name: '2.0 TDCi 150 PS',     code: 'XWDA', fuel: 'Diesel',  oil: '5W-30', power: 150, tires: ['215/50 R17','235/40 R18'] },
          ],
        },
        'Fiesta': {
          'Fiesta VII 2008–2017': [
            { name: '1.0 EcoBoost 100 PS', code: 'SFJA', fuel: 'Benzin',  oil: '5W-20', power: 100, tires: ['175/65 R14','185/60 R15'] },
            { name: '1.25 82 PS',          code: 'STJA', fuel: 'Benzin',  oil: '5W-30', power: 82,  tires: ['175/65 R14','185/60 R15'] },
            { name: 'ST 1.6 EcoBoost 182 PS', code: 'EBBM', fuel: 'Benzin', oil: '5W-30', power: 182, tires: ['205/40 R17'] },
            { name: '1.4 TDCi 68 PS',      code: 'KVJA', fuel: 'Diesel',  oil: '5W-30', power: 68,  tires: ['175/65 R14','185/60 R15'] },
            { name: '1.6 TDCi 90 PS',      code: 'TZJA', fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['185/60 R15','195/50 R16'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  TOYOTA
    // ═══════════════════════════════════════════════════════════
    'Toyota': {
      models: {
        'Yaris': {
          'Yaris III 2011–2020': [
            { name: '1.0 69 PS',        code: '1KRFE',  fuel: 'Benzin',  oil: '0W-20', power: 69,  tires: ['175/65 R14','185/60 R15'] },
            { name: '1.33 99 PS',       code: '1NRFE',  fuel: 'Benzin',  oil: '0W-20', power: 99,  tires: ['185/60 R15','195/50 R16'] },
            { name: '1.5 Hybrid 100 PS',code: '1NZFXE', fuel: 'Hybrid (Benzin)', oil: '0W-20', power: 100, tires: ['185/60 R15','195/50 R16'] },
          ],
        },
        'Corolla': {
          'Corolla E21 2019–': [
            { name: '1.2 Turbo 116 PS', code: '8NR-FTS',fuel: 'Benzin',  oil: '0W-20', power: 116, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.8 Hybrid 122 PS',code: '2ZR-FXE', fuel: 'Hybrid (Benzin)', oil: '0W-16', power: 122, tires: ['205/60 R16','225/45 R17'] },
            { name: '2.0 Hybrid 184 PS',code: 'M20A-FXS',fuel: 'Hybrid (Benzin)', oil: '0W-16', power: 184, tires: ['225/45 R17','225/40 R18'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  RENAULT
    // ═══════════════════════════════════════════════════════════
    'Renault': {
      models: {
        'Clio': {
          'Clio IV 2012–2019': [
            { name: '0.9 TCe 90 PS',    code: 'H4BA400',fuel: 'Benzin',  oil: '5W-40', power: 90,  tires: ['185/65 R15','195/55 R16'] },
            { name: '1.2 TCe 120 PS',   code: 'H5F402', fuel: 'Benzin',  oil: '5W-40', power: 120, tires: ['195/55 R16','205/45 R17'] },
            { name: 'R.S. 1.6 T 200 PS',code: 'M5MT',   fuel: 'Benzin',  oil: '5W-40', power: 200, tires: ['215/40 R17'] },
            { name: '1.5 dCi 75 PS',    code: 'K9K612', fuel: 'Diesel',  oil: '5W-30', power: 75,  tires: ['185/65 R15','195/55 R16'] },
            { name: '1.5 dCi 90 PS',    code: 'K9K608', fuel: 'Diesel',  oil: '5W-30', power: 90,  tires: ['185/65 R15','195/55 R16'] },
          ],
        },
        'Mégane': {
          'Mégane IV 2016–': [
            { name: '1.2 TCe 130 PS',   code: 'H5F404', fuel: 'Benzin',  oil: '5W-40', power: 130, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.3 TCe 140 PS',   code: 'H5H450', fuel: 'Benzin',  oil: '5W-40', power: 140, tires: ['205/55 R17','225/45 R18'] },
            { name: 'R.S. 1.8 T 280 PS',code: 'M5P450', fuel: 'Benzin',  oil: '5W-40', power: 280, tires: ['245/40 R18','245/35 R19'] },
            { name: '1.5 dCi 110 PS',   code: 'K9K837', fuel: 'Diesel',  oil: '5W-30', power: 110, tires: ['205/60 R16','225/45 R17'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  PEUGEOT / CITROËN
    // ═══════════════════════════════════════════════════════════
    'Peugeot': {
      models: {
        '208': {
          '208 I 2012–2019': [
            { name: '1.2 PureTech 82 PS',code: 'HM01', fuel: 'Benzin',  oil: '5W-30', power: 82,  tires: ['185/65 R15','195/55 R16'] },
            { name: '1.2 PureTech 110 PS',code:'HNZ',  fuel: 'Benzin',  oil: '5W-30', power: 110, tires: ['195/55 R16','205/45 R17'] },
            { name: 'GTi 208 PS',         code:'EP6CDT',fuel: 'Benzin',  oil: '5W-30', power: 208, tires: ['215/40 R17'] },
            { name: '1.6 BlueHDi 100 PS', code:'BHY',  fuel: 'Diesel',  oil: '5W-30', power: 100, tires: ['185/65 R15','195/55 R16'] },
          ],
        },
        '308': {
          '308 II 2013–2021': [
            { name: '1.2 PureTech 130 PS',code:'HNZ',  fuel: 'Benzin',  oil: '5W-30', power: 130, tires: ['205/55 R16','225/45 R17'] },
            { name: 'GTi 270 PS',          code:'EP6CDTM',fuel:'Benzin', oil: '5W-30', power: 270, tires: ['235/40 R18'] },
            { name: '1.6 BlueHDi 120 PS', code:'BHX',  fuel: 'Diesel',  oil: '5W-30', power: 120, tires: ['205/55 R16','225/45 R17'] },
            { name: '2.0 BlueHDi 150 PS', code:'DW10FC',fuel: 'Diesel',  oil: '5W-30', power: 150, tires: ['225/45 R17','225/40 R18'] },
          ],
        },
      },
    },

    'Citroën': {
      models: {
        'C3': {
          'C3 III 2016–': [
            { name: '1.2 PureTech 83 PS', code:'HMZ',  fuel: 'Benzin',  oil: '5W-30', power: 83,  tires: ['185/65 R15','195/55 R16'] },
            { name: '1.2 PureTech 110 PS',code:'HNZ',  fuel: 'Benzin',  oil: '5W-30', power: 110, tires: ['195/55 R16','205/45 R17'] },
            { name: '1.5 BlueHDi 102 PS', code:'YHZ',  fuel: 'Diesel',  oil: '5W-30', power: 102, tires: ['185/65 R15','195/55 R16'] },
          ],
        },
      },
    },

    // ═══════════════════════════════════════════════════════════
    //  KIA / HYUNDAI
    // ═══════════════════════════════════════════════════════════
    'Kia': {
      models: {
        'Ceed': {
          'Ceed III 2018–': [
            { name: '1.0 T-GDI 120 PS', code: 'G3LC',  fuel: 'Benzin',  oil: '5W-30', power: 120, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.4 T-GDI 140 PS', code: 'G4LD',  fuel: 'Benzin',  oil: '5W-30', power: 140, tires: ['225/45 R17','225/40 R18'] },
            { name: 'Pro Ceed GT 1.6 T 204 PS', code:'G4FJ', fuel:'Benzin', oil:'5W-30', power: 204, tires: ['225/40 R18'] },
            { name: '1.6 CRDi 136 PS',  code: 'D4FB',  fuel: 'Diesel',  oil: '5W-30', power: 136, tires: ['205/60 R16','225/45 R17'] },
          ],
        },
        'Sportage': {
          'Sportage IV 2016–2021': [
            { name: '1.6 GDI 132 PS',   code: 'G4FD',  fuel: 'Benzin',  oil: '5W-30', power: 132, tires: ['215/70 R16','235/60 R17'] },
            { name: '1.6 T-GDI 177 PS', code: 'G4FJ',  fuel: 'Benzin',  oil: '5W-30', power: 177, tires: ['235/55 R18','235/50 R19'] },
            { name: '2.0 CRDi 136 PS',  code: 'D4HA',  fuel: 'Diesel',  oil: '5W-30', power: 136, tires: ['215/70 R16','235/60 R17'] },
          ],
        },
      },
    },

    'Hyundai': {
      models: {
        'i30': {
          'i30 III PDE 2017–': [
            { name: '1.0 T-GDI 120 PS', code: 'G3LC',  fuel: 'Benzin',  oil: '5W-30', power: 120, tires: ['205/60 R16','225/45 R17'] },
            { name: '1.4 T-GDI 140 PS', code: 'G4LD',  fuel: 'Benzin',  oil: '5W-30', power: 140, tires: ['225/45 R17','225/40 R18'] },
            { name: 'N 2.0 T-GDI 280 PS', code:'G4KH', fuel: 'Benzin',  oil: '5W-40', power: 280, tires: ['235/35 R19'] },
            { name: '1.6 CRDi 136 PS',  code: 'D4FB',  fuel: 'Diesel',  oil: '5W-30', power: 136, tires: ['205/60 R16','225/45 R17'] },
          ],
        },
      },
    },

  }, // end brands

  // ── Lookup helpers ────────────────────────────────────────────

  getBrands() {
    return Object.keys(this.brands).sort();
  },

  getModels(brand) {
    return Object.keys(this.brands[brand]?.models || {}).sort();
  },

  getGenerations(brand, model) {
    return Object.keys(this.brands[brand]?.models[model] || {});
  },

  getVariants(brand, model, generation) {
    return this.brands[brand]?.models[model]?.[generation] || [];
  },

  findVariant(brand, model, generation, variantName) {
    return this.getVariants(brand, model, generation).find(v => v.name === variantName) || null;
  }
};
