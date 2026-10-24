"""Análisis modal robusto para fe2d.Frame2D (reemplazo de Frame2D.modal).

Motivo: con masa rotacional = 1e-4·m, la forma estándar D·K·D tiene un número de
condición ~1e14 y eigh pierde precisión en los modos bajos (hasta 0,27 % en f1 en el
Monte Carlo del modelo C). Aquí se resuelve K φ = λ M φ por desplazamiento-inversión
(sigma = 0), que trabaja con K⁻¹M y es estable para los modos más bajos.
"""
import numpy as np
from scipy.sparse import csc_matrix, diags
from scipy.sparse.linalg import eigsh


def modal_si(fr, nmodes=10, escale=None):
    K = fr.K(escale)[np.ix_(fr.free, fr.free)]
    K = csc_matrix(0.5 * (K + K.T))
    m = fr.Mdiag[fr.free]
    lam, v = eigsh(K, k=nmodes, M=diags(m), sigma=0, which='LM')
    o = np.argsort(lam); lam, v = lam[o], v[:, o]
    full = np.zeros((fr.ndof, nmodes)); full[fr.free] = v
    f = np.sqrt(np.maximum(lam, 0)) / (2 * np.pi)
    mt = fr.Mdiag.reshape(-1, 3)[:, 0].sum(); part = {}
    for d, lab in ((0, 'Y'), (1, 'Z')):
        r = np.zeros(fr.ndof); r[d::3] = 1
        mm = np.einsum('ij,i,ij->j', full, fr.Mdiag, full)
        gam = (full.T @ (fr.Mdiag * r)) / mm
        part[lab] = gam**2 * mm / mt
    return f, full, part
